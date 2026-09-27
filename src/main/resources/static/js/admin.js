const TOKEN_KEY = "waimaiAdminToken";
const ORDER_STATUSES = ["待接单", "制作中", "配送中", "已完成", "已取消"];
let orders = [];
let dishes = [];
let currentView = "orders";

const toast = document.querySelector("#adminToast");
const loginScreen = document.querySelector("#loginScreen");
const adminShell = document.querySelector("#adminShell");

async function api(path, options = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    const response = await fetch(path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? {"X-Admin-Token": token} : {}),
            ...(options.headers || {})
        }
    });
    if (response.status === 401) {
        logout();
        throw new Error("登录已过期，请重新登录");
    }
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

function formatDate(value) {
    if (!value) {
        return "-";
    }
    return new Date(value).toLocaleString("zh-CN", {hour12: false});
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

async function login(password) {
    const result = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({password})
    });
    localStorage.setItem(TOKEN_KEY, result.token);
    showAdmin();
    await loadAll();
}

function showAdmin() {
    loginScreen.hidden = true;
    adminShell.hidden = false;
    refreshIcons();
}

function logout() {
    localStorage.removeItem(TOKEN_KEY);
    adminShell.hidden = true;
    loginScreen.hidden = false;
    document.querySelector("#adminPassword").value = "";
    refreshIcons();
}

async function loadAll() {
    await Promise.all([loadSummary(), loadOrders(), loadDishes()]);
}

async function loadSummary() {
    const data = await api("/api/admin/summary");
    document.querySelector("#statOrders").textContent = data.orderCount ?? 0;
    document.querySelector("#statPending").textContent = data.pendingCount ?? 0;
    document.querySelector("#statRevenue").textContent = money(data.todayRevenue);
    document.querySelector("#statDishes").textContent = data.dishCount ?? 0;
}

async function loadOrders() {
    orders = await api("/api/admin/orders");
    renderOrders();
}

async function loadDishes() {
    dishes = await api("/api/admin/dishes");
    renderDishes();
}

function statusClass(status) {
    return {
        "待接单": "pending",
        "制作中": "cooking",
        "配送中": "delivery",
        "已完成": "done",
        "已取消": "cancelled"
    }[status] || "pending";
}

function renderOrders() {
    document.querySelector("#orderEmpty").hidden = orders.length > 0;
    document.querySelector("#orderList").innerHTML = orders.map(order => `
        <article class="order-card">
            <div class="order-card-head">
                <div>
                    <span class="status-badge ${statusClass(order.status)}">${escapeHtml(order.status)}</span>
                    <h3>${escapeHtml(order.orderNo)}</h3>
                    <small>${formatDate(order.createdAt)}</small>
                </div>
                <strong>${money(order.totalAmount)}</strong>
            </div>
            <div class="order-customer">
                <span><i data-lucide="user-round"></i>${escapeHtml(order.customerName)}</span>
                <span><i data-lucide="phone"></i>${escapeHtml(order.phone)}</span>
                <span><i data-lucide="map-pin"></i>${escapeHtml(order.address)}</span>
            </div>
            <div class="order-dishes">
                ${order.items.map(item => `
                    <div><span>${escapeHtml(item.dishName)} × ${item.quantity}</span><b>${money(item.subtotal)}</b></div>
                `).join("")}
            </div>
            ${order.remark ? `<p class="order-remark">备注：${escapeHtml(order.remark)}</p>` : ""}
            <div class="order-actions">
                <select data-order-status="${order.id}">
                    ${ORDER_STATUSES.map(status => `
                        <option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>
                    `).join("")}
                </select>
                <button class="secondary-button" type="button" data-update-order="${order.id}">
                    <i data-lucide="save"></i>
                    更新状态
                </button>
            </div>
        </article>
    `).join("");
    refreshIcons();
}

function renderDishes() {
    document.querySelector("#dishTableBody").innerHTML = dishes.map(dish => `
        <tr>
            <td>
                <div class="table-dish">
                    <img src="${escapeHtml(dish.imageUrl || "/images/logo.png")}" alt="${escapeHtml(dish.name)}"
                         onerror="this.src='/images/logo.png'">
                    <div>
                        <strong>${escapeHtml(dish.name)}</strong>
                        <small>${escapeHtml(dish.description || "暂无描述")}</small>
                    </div>
                </div>
            </td>
            <td>${escapeHtml(dish.category)}</td>
            <td><strong>${money(dish.price)}</strong></td>
            <td>
                <span class="status-badge ${dish.available ? "done" : "cancelled"}">
                    ${dish.available ? "已上架" : "已下架"}
                </span>
            </td>
            <td>${dish.sortOrder}</td>
            <td>
                <div class="table-actions">
                    <button class="icon-button" type="button" data-edit-dish="${dish.id}" title="编辑">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="icon-button danger" type="button" data-delete-dish="${dish.id}" title="删除">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join("");
    refreshIcons();
}

function switchView(view) {
    currentView = view;
    document.querySelectorAll(".admin-nav-button[data-view]").forEach(button => {
        button.classList.toggle("active", button.dataset.view === view);
    });
    document.querySelector("#ordersView").hidden = view !== "orders";
    document.querySelector("#dishesView").hidden = view !== "dishes";
}

function openDishModal(dish = null) {
    const form = document.querySelector("#dishForm");
    form.reset();
    form.elements.id.value = dish?.id || "";
    form.elements.name.value = dish?.name || "";
    form.elements.category.value = dish?.category || "";
    form.elements.description.value = dish?.description || "";
    form.elements.price.value = dish?.price || "";
    form.elements.imageUrl.value = dish?.imageUrl || "/images/dish-1.jpg";
    form.elements.sortOrder.value = dish?.sortOrder ?? 0;
    form.elements.available.checked = dish?.available ?? true;
    document.querySelector("#dishModalTitle").textContent = dish ? "编辑菜品" : "新增菜品";
    document.querySelector("#dishModal").hidden = false;
    document.body.classList.add("no-scroll");
}

function closeDishModal() {
    document.querySelector("#dishModal").hidden = true;
    document.body.classList.remove("no-scroll");
}

async function saveDish(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = form.get("id");
    const payload = {
        name: form.get("name"),
        category: form.get("category"),
        description: form.get("description"),
        price: Number(form.get("price")),
        imageUrl: form.get("imageUrl"),
        available: form.get("available") === "on",
        sortOrder: Number(form.get("sortOrder") || 0)
    };

    try {
        await api(id ? `/api/admin/dishes/${id}` : "/api/admin/dishes", {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(payload)
        });
        closeDishModal();
        showToast(id ? "菜品已更新" : "菜品已新增");
        await Promise.all([loadDishes(), loadSummary()]);
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function updateOrderStatus(orderId) {
    const select = document.querySelector(`[data-order-status="${orderId}"]`);
    try {
        await api(`/api/admin/orders/${orderId}/status`, {
            method: "PATCH",
            body: JSON.stringify({status: select.value})
        });
        showToast("订单状态已更新");
        await Promise.all([loadOrders(), loadSummary()]);
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function deleteDish(dishId) {
    if (!window.confirm("确定删除这个菜品吗？")) {
        return;
    }
    try {
        await api(`/api/admin/dishes/${dishId}`, {method: "DELETE"});
        showToast("菜品已删除");
        await Promise.all([loadDishes(), loadSummary()]);
    } catch (error) {
        showToast(error.message, "error");
    }
}

document.querySelector("#adminLoginForm").addEventListener("submit", event => {
    event.preventDefault();
    login(document.querySelector("#adminPassword").value)
        .catch(error => showToast(error.message, "error"));
});

document.querySelector("#logoutButton").addEventListener("click", logout);
document.querySelector("#refreshOrdersButton").addEventListener("click", () => {
    loadAll().then(() => showToast("数据已刷新")).catch(error => showToast(error.message, "error"));
});

document.querySelectorAll(".admin-nav-button[data-view]").forEach(button => {
    button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelector("#addDishButton").addEventListener("click", () => openDishModal());
document.querySelector("#closeDishModalButton").addEventListener("click", closeDishModal);
document.querySelector("#dishForm").addEventListener("submit", saveDish);

document.addEventListener("click", event => {
    const updateButton = event.target.closest("[data-update-order]");
    if (updateButton) {
        updateOrderStatus(Number(updateButton.dataset.updateOrder));
        return;
    }
    const editButton = event.target.closest("[data-edit-dish]");
    if (editButton) {
        openDishModal(dishes.find(dish => dish.id === Number(editButton.dataset.editDish)));
        return;
    }
    const deleteButton = event.target.closest("[data-delete-dish]");
    if (deleteButton) {
        deleteDish(Number(deleteButton.dataset.deleteDish));
    }
});

if (localStorage.getItem(TOKEN_KEY)) {
    loadAll().catch(() => logout());
}

refreshIcons();
