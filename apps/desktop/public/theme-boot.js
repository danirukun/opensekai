// Sets the theme before the body parses, so the first paint has it. The CSP allows a script file, not an inline script.
// This copies parseTheme, resolveTheme and applyTheme of src/editor/theme.ts; test/theme-boot.test.ts checks that they agree.
(function () {
 var stored = null;
 try { stored = localStorage.getItem('opensekai.theme'); } catch (error) { stored = null; }
 var systemDark = false;
 try { systemDark = matchMedia('(prefers-color-scheme: dark)').matches; } catch (error) { systemDark = false; }
 var known = stored === 'light' || stored === 'dark' || stored === 'dark-navy';
 var resolved = known ? stored : systemDark ? 'dark' : 'light';
 var scheme = resolved === 'light' ? 'light' : 'dark';
 var root = document.documentElement;
 root.dataset.theme = scheme;
 if (resolved === 'dark-navy') root.dataset.palette = 'navy';
 root.style.colorScheme = scheme;
})();
