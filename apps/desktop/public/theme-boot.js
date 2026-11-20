// Sets the theme before the body parses, so the first paint has it. The CSP allows a script file, not an inline script.
// This copies parseTheme and resolveTheme of src/editor/theme.ts; test/theme-boot.test.ts checks that both agree.
(function () {
 var stored = null;
 try { stored = localStorage.getItem('opensekai.theme'); } catch (error) { stored = null; }
 var systemDark = false;
 try { systemDark = matchMedia('(prefers-color-scheme: dark)').matches; } catch (error) { systemDark = false; }
 var theme = stored === 'light' || stored === 'dark' ? stored : systemDark ? 'dark' : 'light';
 document.documentElement.dataset.theme = theme;
 document.documentElement.style.colorScheme = theme;
})();
