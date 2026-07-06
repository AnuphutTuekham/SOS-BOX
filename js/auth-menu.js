(() => {
    "use strict";

    function getSession() {
        return window.SOSBoxAuth?.getSession?.() || null;
    }

    function logout() {
        window.SOSBoxAuth?.logout?.();
    }

    function buildMenu(trigger) {
        const wrapper = document.createElement("div");
        wrapper.className = "auth-menu";

        const dropdown = document.createElement("div");
        dropdown.className = "auth-dropdown";

        const session = getSession();
        if (session?.email) {
            const info = document.createElement("div");
            info.className = "auth-dropdown-info";
            info.textContent = session.email;
            dropdown.appendChild(info);
        }

        const item = document.createElement("button");
        item.type = "button";
        item.className = "auth-dropdown-item";
        item.textContent = session ? "ออกจากระบบ" : "เข้าสู่ระบบ";
        item.addEventListener("click", () => {
            if (session) {
                logout();
                window.location.reload();
                return;
            }
            window.location.href = "register.html";
        });
        dropdown.appendChild(item);

        wrapper.appendChild(trigger.cloneNode(true));
        wrapper.appendChild(dropdown);
        return wrapper;
    }

    function init() {
        const trigger = document.querySelector(".profile-link-icon[data-auth-menu]");
        if (!(trigger instanceof HTMLElement)) return;

        const menu = buildMenu(trigger);
        const parent = trigger.parentElement;
        if (!parent) return;
        parent.replaceChild(menu, trigger);

        const btn = menu.querySelector(".profile-link-icon");
        const dropdown = menu.querySelector(".auth-dropdown");
        if (!(btn instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            dropdown.classList.toggle("open");
        });

        document.addEventListener("click", (e) => {
            if (!menu.contains(e.target)) {
                dropdown.classList.remove("open");
            }
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
