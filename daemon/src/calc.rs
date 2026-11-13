// SPDX-License-Identifier: GPL-3.0-or-later
use std::time::{Duration, Instant};

use fend_core::{Context, Interrupt, evaluate_with_interrupt};

const MAX_INPUT: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalcResult {
    pub expression: String,
    pub result: String,
}

pub fn evaluate(input: &str, timeout: Duration) -> Option<CalcResult> {
    let expression = input.trim();
    if !looks_like_calculation(expression) {
        return None;
    }

    let expression = expression.strip_prefix('=').unwrap_or(expression).trim();
    if expression.is_empty() {
        return None;
    }

    let mut context = Context::new();
    let deadline = Deadline::new(timeout);
    let result = evaluate_with_interrupt(expression, &mut context, &deadline).ok()?;
    let result = result.get_main_result().trim();

    if result.is_empty() || result == expression {
        return None;
    }

    Some(CalcResult {
        expression: input.trim().to_owned(),
        result: result.to_owned(),
    })
}

pub fn looks_like_calculation(input: &str) -> bool {
    let input = input.trim();
    if input.is_empty() || input.len() > MAX_INPUT {
        return false;
    }

    input.starts_with('=')
        || input
            .chars()
            .any(|character| character.is_ascii_alphabetic())
        || input
            .chars()
            .any(|character| matches!(character, '+' | '-' | '*' | '/' | '^' | '%' | '(' | ')'))
}

struct Deadline {
    end: Instant,
}

impl Deadline {
    fn new(timeout: Duration) -> Self {
        Self {
            end: Instant::now() + timeout,
        }
    }
}

impl Interrupt for Deadline {
    fn should_interrupt(&self) -> bool {
        Instant::now() >= self.end
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_arithmetic_and_units() {
        assert_eq!(
            evaluate("1+1", Duration::from_millis(25)).unwrap().result,
            "2"
        );
        assert_eq!(
            evaluate("1 km to m", Duration::from_millis(25))
                .unwrap()
                .result,
            "1000 m"
        );
        assert_eq!(
            evaluate("2 hours in minutes", Duration::from_millis(25))
                .unwrap()
                .result,
            "120 minutes"
        );
    }

    #[test]
    fn rejects_plain_numbers_and_non_calculations() {
        assert!(evaluate("42", Duration::from_millis(25)).is_none());
        assert!(evaluate("firefox", Duration::from_millis(25)).is_none());
        assert!(evaluate("1+", Duration::from_millis(25)).is_none());
        assert!(evaluate("", Duration::from_millis(25)).is_none());
    }

    #[test]
    fn strips_a_leading_equals_and_rejects_currency() {
        assert_eq!(
            evaluate("= 3*7", Duration::from_millis(25)).unwrap().result,
            "21"
        );
        assert!(evaluate("10 USD to EUR", Duration::from_millis(25)).is_none());
    }

    #[test]
    fn enforces_the_input_cap_and_deadline_type() {
        assert!(evaluate(&"1+".repeat(300), Duration::from_millis(25)).is_none());
        let deadline = Deadline::new(Duration::ZERO);
        assert!(deadline.should_interrupt());
    }
}
