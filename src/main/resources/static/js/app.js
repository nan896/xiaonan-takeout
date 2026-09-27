const state = {
    dishes: [],
    categories: [],
    category: "全部",
    keyword: "",
    cart: new Map()
};

const dishGrid = document.querySelector("#dishGrid");
const categoryBar = document.querySelector("#categoryBar");
const cartBar = document.querySelector("#cartBar");
const cartDrawer = document.querySelector("#cartDrawer");
const drawerMask = document.querySelector("#drawerMask");
const checkoutModal = document.querySelector("#checkoutModal");
const checkoutForm = document.querySelector("#checkoutForm");
const toast = document.querySelector("#toast");

async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: {"Content-Type": "application/json", ...(options.headers || {})},
        ...options
    });
    if (!response.ok) {
        let message = "请求失败";
        try {
            const body = await response.json();
            message = body.detail || body.message || body.title || message;
        } catch {
            message = await response.text() || message;
        }
        throw new Error(message);
    }
    return response.json();
}

function money(value) {
    return `¥${Number(value || 0).toFixed(2)}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function refreshIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function showToast(message, type = "success") {
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
        toast.className = "toast";
    }, 2200);
}

async function loadCategories() {
    state.categories = await api("/api/shop/categories");
    renderCategories();
}

async function loadDishes() {
    const params = new URLSearchParams();
    if (state.category && state.category !== "全部") {
        params.set("category", state.category);
    }
    if (state.keyword) {
        params.set("keyword", state.keyword);
    }
    state.dishes = await api(`/api/shop/dishes?${params}`);
    renderDishes();
}

function renderCategories() {
    const categories = ["全部", ...state.categories];
    categoryBar.innerHTML = categories.map(category => `
        <button class="category-chip ${category === state.category ? "active" : ""}"
                type="button" data-category="${escapeHtml(category)}">
            ${escapeHtml(category)}
        </button>
    `).join("");
}

function renderDishes() {
    document.querySelector("#emptyState").hidden = state.dishes.length > 0;
    dishGrid.innerHTML = state.dishes.map(dish => {
        const quantity = state.cart.get(dish.id)?.quantity || 0;
        return `
            <article class="dish-card">
                <div class="dish-image">
                    <img src="${escapeHtml(dish.imageUrl || "/images/logo.png")}" alt="${escapeHtml(dish.name)}"
                         onerror="this.src='/images/logo.png'">
                    <span class="dish-category">${escapeHtml(dish.category)}</span>
                </div>
                <div class="dish-body">
                    <h3>${escapeHtml(dish.name)}</h3>
                    <p>${escapeHtml(dish.description || "新鲜现做，欢迎品尝")}</p>
                    <div class="dish-footer">
                        <strong>${money(dish.price)}</strong>
                        ${quantity > 0 ? `
                            <div class="quantity-control">
                                <button type="button" data-cart-action="minus" data-id="${dish.id}">
                                    <i data-lucide="minus"></i>
                                </button>
                                <span>${quantity}</span>
                                <button type="button" data-cart-action="plus" data-id="${dish.id}">
                                    <i data-lucide="plus"></i>
                                </button>
                            </div>
                        ` : `
                            <button class="add-button" type="button" data-cart-action="plus" data-id="${dish.id}">
                                <i data-lucide="plus"></i>
                                加入
                            </button>
                        `}
                    </div>
                </div>
            </article>
        `;
    }).join("");
    refreshIcons();
}

function getCartSummary() {
    let count = 0;
    let total = 0;
    for (const item of state.cart.values()) {
        count += item.quantity;
        total += item.quantity * Number(item.dish.price);
    }
    return {count, total};
}

function renderCart() {
    const {count, total} = getCartSummary();
    cartBar.hidden = count === 0;
    document.querySelector("#cartCount").textContent = count;
    document.querySelector("#cartTotal").textContent = money(total);
    document.querySelector("#drawerTotal").textContent = money(total);
    document.querySelector("#checkoutCount").textContent = count;
    document.querySelector("#checkoutTotal").textContent = money(total);

    const cartItems = document.querySelector("#cartItems");
    if (state.cart.size === 0) {
        cartItems.innerHTML = `
            <div class="cart-empty">
                <i data-lucide="shopping-basket"></i>
                <p>购物车还是空的</p>
            </div>
        `;
    } else {
        cartItems.innerHTML = [...state.cart.values()].map(({dish, quantity}) => `
            <div class="cart-item">
                <img src="${escapeHtml(dish.imageUrl || "/images/logo.png")}" alt="${escapeHtml(dish.name)}">
                <div class="cart-item-info">
                    <strong>${escapeHtml(dish.name)}</strong>
                    <span>${money(dish.price)}</span>
                </div>
                <div class="quantity-control">
                    <button type="button" data-cart-action="minus" data-id="${dish.id}">
                        <i data-lucide="minus"></i>
                    </button>
                    <span>${quantity}</span>
                    <button type="button" data-cart-action="plus" data-id="${dish.id}">
                        <i data-lucide="plus"></i>
                    </button>
                </div>
            </div>
        `).join("");
    }
    refreshIcons();
}

function changeCart(dishId, delta) {
    const dish = state.dishes.find(item => item.id === dishId);
    if (!dish) {
        return;
    }
    const current = state.cart.get(dishId)?.quantity || 0;
    const next = current + delta;
    if (next <= 0) {
        state.cart.delete(dishId);
    } else {
        state.cart.set(dishId, {dish, quantity: next});
    }
    renderDishes();
    renderCart();
}

function openCart() {
    if (state.cart.size === 0) {
        showToast("请先选择菜品", "error");
        return;
    }
    cartDrawer.classList.add("open");
    cartDrawer.setAttribute("aria-hidden", "false");
    drawerMask.hidden = false;
    document.body.classList.add("no-scroll");
}

function closeCart() {
    cartDrawer.classList.remove("open");
    cartDrawer.setAttribute("aria-hidden", "true");
    drawerMask.hidden = true;
    document.body.classList.remove("no-scroll");
}

function openCheckout() {
    if (state.cart.size === 0) {
        showToast("请先选择菜品", "error");
        return;
    }
    closeCart();
    checkoutModal.hidden = false;
    document.body.classList.add("no-scroll");
}

function closeCheckout() {
    checkoutModal.hidden = true;
    document.body.classList.remove("no-scroll");
}

async function submitOrder(event) {
    event.preventDefault();
    const submitButton = checkoutForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const form = new FormData(checkoutForm);
    const payload = {
        customerName: form.get("customerName"),
        phone: form.get("phone"),
        address: form.get("address"),
        remark: form.get("remark"),
        items: [...state.cart.values()].map(({dish, quantity}) => ({
            dishId: dish.id,
            quantity
        }))
    };

    try {
        const result = await api("/api/shop/orders", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        state.cart.clear();
        checkoutForm.reset();
        closeCheckout();
        renderDishes();
        renderCart();
        document.querySelector("#successOrderNo").textContent = result.orderNo;
        document.querySelector("#successModal").hidden = false;
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        submitButton.disabled = false;
    }
}

categoryBar.addEventListener("click", event => {
    const button = event.target.closest("[data-category]");
    if (!button) {
        return;
    }
    state.category = button.dataset.category;
    renderCategories();
    loadDishes().catch(error => showToast(error.message, "error"));
});

document.addEventListener("click", event => {
    const cartButton = event.target.closest("[data-cart-action]");
    if (cartButton) {
        changeCart(Number(cartButton.dataset.id), cartButton.dataset.cartAction === "plus" ? 1 : -1);
    }
});

let searchTimer;
document.querySelector("#searchInput").addEventListener("input", event => {
    state.keyword = event.target.value.trim();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
        loadDishes().catch(error => showToast(error.message, "error"));
    }, 250);
});

cartBar.addEventListener("click", openCart);
document.querySelector("#closeCartButton").addEventListener("click", closeCart);
drawerMask.addEventListener("click", closeCart);
document.querySelector("#checkoutButton").addEventListener("click", openCheckout);
document.querySelector("#closeCheckoutButton").addEventListener("click", closeCheckout);
checkoutForm.addEventListener("submit", submitOrder);
document.querySelector("#successButton").addEventListener("click", () => {
    document.querySelector("#successModal").hidden = true;
    document.body.classList.remove("no-scroll");
    document.querySelector("#menu").scrollIntoView({behavior: "smooth"});
});

Promise.all([loadCategories(), loadDishes()])
    .then(renderCart)
    .catch(error => showToast(error.message, "error"))
    .finally(refreshIcons);
