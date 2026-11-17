# Current-State Issue Checklist

> Open issues reported for the current state of the Sift extension. This list records the symptoms only; investigation details and fixes are intentionally left out.

## Extension settings

- [x] **Extension settings do not open**

  Opening the settings for `sift@alphabeast97.github.io` shows:

  ```text
  The settings of extension sift@alphabeast97.github.io had an error:
  ImportError: Unable to load file from: resource:///org/gnome/shell/extensions/prefs.js (The resource at “/org/gnome/shell/extensions/prefs.js” does not exist)
  
  Stack trace:
    _init/GLib.MainLoop.prototype.runAsync/</<@resource:///org/gnome/gjs/modules/core/overrides/GLib.js:266:26
  ```

## App grid

- [x] **App grid layout can become severely broken**

  The app grid sometimes renders with overlapping, compressed, or otherwise unusable app icons and labels.

- [x] **App grid does not snap to pages**

  Page navigation can stop partway through a page transition instead of settling on a complete page.

## Panel appearance

- [x] **Rounded corners are not applied consistently across all layers**

  The panel's corner areas can show visible layer or background mismatches, including at the four panel corners.

## Additional issues

- [x] **Super+A does not open Sift on first try**

  After login, Super+A does not open the app grid until Super is pressed first; occasionally it still fails afterwards.

- [ ] **Only the top window is used as the glass backdrop**

  With several windows behind the panel, the backdrop shows only the topmost one and appears glitched.

- [x] **GNOME's overview flashes at login**

  After logging in, the stock overview appears for a moment before the desktop. Sift should go straight to the desktop.

- [ ] ~~**Add selectable standard app-grid sizes** (deferred from the first release)~~ — cut

  ~~Preferences should offer standard grid sizes. Fixed-panel presets looked poor; revisit together with a panel that sizes itself around the chosen grid.~~

- [x] **Make Sift's shortcuts configurable and make the overview takeover optional**

  Preferences should let people pick their own Sift shortcuts without overwriting existing keybindings. They should also choose whether Sift disables GNOME's overview. If the overview stays enabled, give Sift a second pair of shortcuts (Ctrl+Space, Alt+A) so both can coexist.

Add newly identified issues here as they are reported.
