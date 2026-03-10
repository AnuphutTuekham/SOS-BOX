(function () {
    const currentFile = (window.location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
    const aliasMap = {
        '': 'dashboard.html',
        'index.html': 'dashboard.html'
    };
    const normalizedCurrent = aliasMap[currentFile] || currentFile;

    const links = document.querySelectorAll('.sidebar a.menu-item, .sidebar a.nav-item, .quick-links a');
    if (!links.length) {
        return;
    }

    links.forEach((link) => link.classList.remove('active'));

    let activeLink = null;
    links.forEach((link) => {
        const href = link.getAttribute('href');
        if (!href) {
            return;
        }

        const fileName = href.split('?')[0].split('#')[0].split('/').pop().toLowerCase();
        if (fileName === normalizedCurrent && !activeLink) {
            activeLink = link;
        }
    });

    if (activeLink) {
        activeLink.classList.add('active');
    }
})();