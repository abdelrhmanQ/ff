const API_URL = "http://localhost:3000";

// في بداية ملف script.js - بعد تعريف المتغيرات
// التحقق من الجلسة عند تحميل الصفحة
function checkSession() {
    const sessionData = localStorage.getItem("current_session_v3");
    if (!sessionData) {
        // إذا لم توجد جلسة، ارجع إلى صفحة تسجيل الدخول
        window.location.href = "login.html";
        return null;
    }
    return JSON.parse(sessionData);
}

// دالة لتحديث بروفايل المستخدم
function updateUserProfile(session) {
    // تحديث header span
    const headerUsername = document.getElementById("header-username");
    if (headerUsername) headerUsername.textContent = session.name || session.username;

    const userProfileSpan = document.querySelector(".user-profile span");
    if (userProfileSpan && !headerUsername) {
        userProfileSpan.textContent = session.name;
    }

    const userProfileImg = document.querySelector(".user-profile img");
    if (userProfileImg) {
        const nameForAvatar = session.name || "المستخدم";
        userProfileImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(nameForAvatar)}&background=7c3aed&color=fff`;
    }

    // إخفاء قسم الموظفين من السايدبار إذا كاشير
    const empNav = document.getElementById("employees-nav");
    if (empNav && (session.role || "").toLowerCase() !== "admin") {
        empNav.style.display = "none";
    }
}

// ==============================
// Permissions (Admin / Cashier)
// ==============================
const ROLE_PERMISSIONS = {
    admin: new Set(["dashboard", "stock", "sizes", "payment", "checkout", "reports", "returns", "suppliers", "qr", "employees", "online-orders", "customers"]),
    cashier: new Set(["stock", "payment", "returns", "reports", "checkout", "online-orders", "customers"])
};

function applyRolePermissions(session) {
    const role = (session.role || "admin").toLowerCase();
    const allowed = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.admin;

    // Add lock icon to restricted items (keep them clickable for "no access" message)
    navItems.forEach(item => {
        const section = item.getAttribute("data-section");
        item.classList.remove("restricted");
        const existingLock = item.querySelector(".lock-icon");
        if (existingLock) existingLock.remove();

        if (!allowed.has(section)) {
            item.classList.add("restricted");
            const lock = document.createElement("span");
            lock.className = "lock-icon";
            lock.style.marginRight = "8px";
            lock.innerHTML = "🔒";
            item.appendChild(lock);
        }
    });
}

function hasAccess(session, section) {
    const role = (session.role || "admin").toLowerCase();
    const allowed = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.admin;
    return allowed.has(section);
}

function showAccessDenied() {
    // small toast-like popup
    let el = document.getElementById("access-denied-toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "access-denied-toast";
        el.style.position = "fixed";
        el.style.bottom = "20px";
        el.style.left = "20px";
        el.style.zIndex = "9999";
        el.style.background = "rgba(15, 23, 42, 0.95)";
        el.style.color = "#fff";
        el.style.padding = "14px 16px";
        el.style.borderRadius = "12px";
        el.style.boxShadow = "0 10px 30px rgba(0,0,0,.25)";
        el.style.maxWidth = "280px";
        el.style.fontSize = "14px";
        document.body.appendChild(el);
    }
    el.innerHTML = "<div style='font-size:18px;margin-bottom:6px'>🔒 u don't have access</div><div style='opacity:.9'>معندكش صلاحيه</div>";
    el.style.opacity = "1";
    clearTimeout(window.__accessDeniedTimer);
    window.__accessDeniedTimer = setTimeout(() => {
        el.style.opacity = "0";
    }, 2500);
}

// دالة تسجيل الخروج (يمكن إضافتها لاحقاً)
function logout() {
    localStorage.removeItem("current_session_v3");
    window.location.href = "login.html";
}

// قاعدة البيانات المحسنة مع التتبع في الوقت الحقيقي

// حالة التطبيق
let currentSection = "dashboard";
let cart = [];
let qrScanner = null;
let editingStockProductId = null;
let editingPaymentId = null;
let CURRENT_SESSION = null;

// عناصر DOM
const navItems = document.querySelectorAll(".nav-item");
const contentSections = document.querySelectorAll(".content-section");
const pageTitle = document.getElementById("page-title");
const productsTable = document.getElementById("products-table");
const recentSales = document.getElementById("recent-sales");
const activityLogs = document.getElementById("activity-logs");
const cartItemsList = document.getElementById("cart-items-list");
const subtotalEl = document.getElementById("subtotal");
const taxEl = document.getElementById("tax");
const taxEnabledEl = document.getElementById("tax-enabled");
const taxRateEl = document.getElementById("tax-rate");

// Tax settings (saved locally so we don't touch existing DB logic)
function getTaxSettings() {
    const enabled = taxEnabledEl ? !!taxEnabledEl.checked : false;
    const ratePct = taxRateEl ? Number(taxRateEl.value) : 0;
    const rate = isNaN(ratePct) ? 0 : Math.max(0, ratePct) / 100;
    return { enabled, rate, ratePct: isNaN(ratePct) ? 0 : Math.max(0, ratePct) };
}
function computeTax(subtotal) {
    const { enabled, rate } = getTaxSettings();
    return enabled ? (subtotal * rate) : 0;
}

// Load saved tax settings
try {
    if (taxEnabledEl) taxEnabledEl.checked = localStorage.getItem("taxEnabled") === "1";
    if (taxRateEl && localStorage.getItem("taxRatePct") !== null) taxRateEl.value = localStorage.getItem("taxRatePct");
} catch (e) { }

// Save + refresh totals when tax changes
function onTaxSettingsChange() {
    try {
        if (taxEnabledEl) localStorage.setItem("taxEnabled", taxEnabledEl.checked ? "1" : "0");
        if (taxRateEl) localStorage.setItem("taxRatePct", String(Number(taxRateEl.value) || 0));
    } catch (e) { }
    // Refresh cart totals display
    updateCartDisplay && updateCartDisplay();
}
if (taxEnabledEl) taxEnabledEl.addEventListener("change", onTaxSettingsChange);
if (taxRateEl) taxRateEl.addEventListener("input", onTaxSettingsChange);

const discountEl = document.getElementById("discount");
const totalEl = document.getElementById("total");
const totalAmountEl = document.getElementById("total-amount");
const productModal = document.getElementById("product-modal");
const receiptModal = document.getElementById("receipt-modal");
const manualAddModal = document.getElementById("manual-add-modal");
const editPaymentModal = document.getElementById("edit-payment-modal");
const closeModalButtons = document.querySelectorAll(".close-modal");
const addProductBtn = document.getElementById("add-product-btn");
const productForm = document.getElementById("product-form");
const scanQrBtn = document.getElementById("scan-qr-btn");
const stopScanBtn = document.getElementById("stop-scan-btn");
const manualAddBtn = document.getElementById("manual-add-btn");
const clearCartBtn = document.getElementById("clear-cart-btn");
const completeSaleBtn = document.getElementById("complete-sale-btn");
const printReceiptBtn = document.getElementById("print-receipt-btn");
const searchBtn = document.getElementById("search-btn");
const qrScannerContainer = document.getElementById("qr-scanner");
const searchProductInput = document.getElementById("search-product");
const searchResults = document.getElementById("search-results");
const paymentMethodsList = document.getElementById("payment-methods-list");
const addPaymentBtn = document.getElementById("add-payment-btn");
const editPaymentForm = document.getElementById("edit-payment-form");
const deletePaymentBtn = document.getElementById("delete-payment-btn");
const addSizeBtn = document.getElementById("add-size-btn");
const customerNameInput = document.getElementById("customer-name");
const paymentMethodSelect = document.getElementById("payment-method");
const cashierNameInput = document.getElementById("cashier-name");
const discountInput = document.getElementById("discount-input");

// Dashboard reset + stock wipe
const resetDayBtn = document.getElementById("reset-day-btn");
const resetMonthBtn = document.getElementById("reset-month-btn");
const clearStockBtn = document.getElementById("clear-stock-btn");

// Barcode modal (NOTE: we will ALSO query lazily inside functions to avoid any null-caching issues)
const barcodeModal = document.getElementById("barcode-modal");
const barcodeText = document.getElementById("barcode-text");
const barcodeProductNameEl = document.getElementById("barcode-product-name");
const barcodeProductInfoEl = document.getElementById("barcode-product-info");

// تهيئة التطبيق
async function init() {
    // التحقق من الجلسة أولاً
    const session = checkSession();
    if (!session) return;
    CURRENT_SESSION = session;

    // تحديث اسم المستخدم في الهيدر
    updateUserProfile(session);

    // تعيين اسم الكاشير في قسم المبيعات
    if (cashierNameInput) {
        cashierNameInput.value = session.name || session.username || '';
    }

    // تفعيل صلاحيات المستخدم
    applyRolePermissions(session);

    // تحميل البيانات الأولية من قاعدة البيانات
    await loadProductsTable();
    await loadRecentSales();
    await loadActivityLogs();
    await loadPaymentMethods();
    await loadSuppliersTable();
    await updateDashboardStats();

    // Systems
    initSuppliersSystem();
    await initReturnsSystem();
    initOnlineOrdersSystem();
    initCustomersSystem();

    // إعداد مستمعي الأحداث
    setupEventListeners();

    // تعيين تاريخ اليوم للفاتورة
    updateReceiptDate();

    // لو كاشير -> دخله على المبيعات/الدفع مباشرة
    if ((session.role || "").toLowerCase() === "cashier") {
        switchSection("checkout");
    } else {
        switchSection("dashboard");
    }

    // إضافة سجلات أولية
    addLog("النظام", "تهيئة التطبيق", "تم تشغيل نظام إدارة المتجر بنجاح");
}

// إعداد جميع مستمعي الأحداث
function setupEventListeners() {
    // Helper: safe event binding (prevents JS crash if element is missing)
    const on = (el, event, handler) => {
        if (el) el.addEventListener(event, handler);
    };

    // التنقل
    navItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const section = item.getAttribute("data-section");
            if (CURRENT_SESSION && !hasAccess(CURRENT_SESSION, section)) {
                showAccessDenied();
                return;
            }
            switchSection(section);
        });
    });

    // أزرار إغلاق النوافذ المنبثقة
    closeModalButtons.forEach(button => {
        button.addEventListener("click", () => {
            closeAllModals();
        });
    });

    // إغلاق النوافذ المنبثقة عند النقر خارجها
    window.addEventListener("click", (e) => {
        if (e.target.classList.contains("modal")) {
            closeAllModals();
        }
    });

    // نموذج المنتج
    on(addProductBtn, "click", () => openProductModal());
    on(productForm, "submit", async (e) => {
        e.preventDefault();
        await saveProduct();
    });

    // أزرار الدفع
    on(scanQrBtn, "click", startQRScanner);
    on(stopScanBtn, "click", stopQRScanner);
    on(manualAddBtn, "click", () => {
        if (manualAddModal) manualAddModal.classList.add("active");
    });

    on(clearCartBtn, "click", clearCart);
    on(completeSaleBtn, "click", completeSale);
    on(printReceiptBtn, "click", printReceipt);

    // زر البحث
    on(searchBtn, "click", searchProduct);

    // طباعة الفاتورة من النافذة المنبثقة
    on(document.getElementById("print-receipt-modal-btn"), "click", () => window.print());

    on(document.getElementById("close-receipt-btn"), "click", () => {
        if (receiptModal) receiptModal.classList.remove("active");
    });

    // طرق الدفع
    on(addPaymentBtn, "click", addPaymentMethod);
    on(editPaymentForm, "submit", async (e) => {
        e.preventDefault();
        await savePaymentMethod();
    });
    on(deletePaymentBtn, "click", deletePaymentMethod);

    // إدارة المقاسات
    on(addSizeBtn, "click", addSizeOption);

    // Dashboard Reset (Marker Reset + خيار حذف الفواتير)
    if (resetDayBtn) {
        resetDayBtn.addEventListener("click", () => handleDashboardReset("day"));
    }
    if (resetMonthBtn) {
        resetMonthBtn.addEventListener("click", () => handleDashboardReset("month"));
    }

    // Clear all stock (set stock=0)
    if (clearStockBtn) {
        clearStockBtn.addEventListener("click", async () => {
            if (!CURRENT_SESSION || (CURRENT_SESSION.role || "").toLowerCase() !== "admin") {
                showAccessDenied();
                return;
            }
            if (!confirm("هل أنت متأكد؟ سيتم تصفير المخزون لكل المنتجات.")) return;
            try {
                const r = await fetch(`${API_URL}/products/clear-stock`, { method: "POST" });
                if (!r.ok) throw new Error();
                await loadProductsTable();
                await updateDashboardStats();
                alert("تم تصفير المخزون بنجاح");
            } catch (e) {
                alert("حدث خطأ أثناء تصفير المخزون");
            }
        });
    }

    // البحث في الوقت الحقيقي
    on(searchProductInput, "input", function () {
        if (this.value.length >= 2) {
            searchProduct();
        }
    });

    // تحديث الخصم لحظياً
    if (discountInput) {
        discountInput.addEventListener("input", () => updateCartDisplay());
    }

    // زر تسجيل الخروج
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
    }

    // زر Dark Mode
    const darkToggle = document.getElementById("dark-mode-toggle");
    if (darkToggle) {
        // Load saved preference
        if (localStorage.getItem("darkMode") === "1") {
            document.documentElement.setAttribute("data-theme", "dark");
            darkToggle.innerHTML = '<i class="fas fa-sun"></i>';
        }
        darkToggle.addEventListener("click", () => {
            const isDark = document.documentElement.getAttribute("data-theme") === "dark";
            if (isDark) {
                document.documentElement.removeAttribute("data-theme");
                darkToggle.innerHTML = '<i class="fas fa-moon"></i>';
                localStorage.setItem("darkMode", "0");
            } else {
                document.documentElement.setAttribute("data-theme", "dark");
                darkToggle.innerHTML = '<i class="fas fa-sun"></i>';
                localStorage.setItem("darkMode", "1");
            }
        });
    }

    // زر Sidebar Toggle
    const sidebarToggle = document.getElementById("sidebar-toggle");
    const sidebarElement = document.querySelector(".sidebar");
    if (sidebarToggle && sidebarElement) {
        if (localStorage.getItem("sidebarCollapsed") === "1") {
            sidebarElement.classList.add("collapsed");
        }
        sidebarToggle.addEventListener("click", () => {
            sidebarElement.classList.toggle("collapsed");
            if (sidebarElement.classList.contains("collapsed")) {
                localStorage.setItem("sidebarCollapsed", "1");
            } else {
                localStorage.setItem("sidebarCollapsed", "0");
            }
        });
    }

    // نموذج الموظف
    const employeeForm = document.getElementById("employee-form");
    if (employeeForm) {
        employeeForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            await saveEmployee();
        });
    }
    const addEmpBtn = document.getElementById("add-employee-btn");
    if (addEmpBtn) {
        addEmpBtn.addEventListener("click", () => openEmployeeModal());
    }

    // جلب المنتجات لقائمة الباركود
    loadProductsForBarcodeSelector();

    // إذا تغيّر الاختيار
    const qrSelect = document.getElementById("qrProductSelect");
    if (qrSelect) {
        qrSelect.addEventListener("change", function () {
            const val = this.value;
            if (!val) return;
            try {
                const p = JSON.parse(val);
                if (document.getElementById("qrProductCode")) document.getElementById("qrProductCode").value = p.barcode || p.id || "";
                if (document.getElementById("qrProductName")) document.getElementById("qrProductName").value = p.name || "";
                if (document.getElementById("qrPrice")) document.getElementById("qrPrice").value = p.price || "";
                if (document.getElementById("qrColor")) document.getElementById("qrColor").value = p.color || "";
                if (document.getElementById("qrSize")) document.getElementById("qrSize").value = p.size || "";
                // trigger barcode generation
                if (typeof generateBarcode === "function") generateBarcode();
            } catch (e) { }
        });
    }
}

// التبديل بين الأقسام
function switchSection(section) {
    // تحديث التنقل
    navItems.forEach(item => {
        item.classList.remove("active");
        if (item.getAttribute("data-section") === section) {
            item.classList.add("active");
        }
    });

    // تحديث أقسام المحتوى
    contentSections.forEach(content => {
        content.classList.remove("active");
        if (content.id === section) {
            content.classList.add("active");
        }
    });

    // تحديث عنوان الصفحة
    const titles = {
        dashboard: "لوحة التحكم",
        stock: "إدارة المخزون",
        sizes: "إدارة المقاسات",
        payment: "طرق الدفع",
        checkout: "المبيعات / الدفع",
        reports: "التقارير والسجلات",
        returns: "المرتجعات",
        onlineOrders: "الطلبات الأونلاين",
        "online-orders": "الطلبات الأونلاين",
        customers: "العملاء",
        suppliers: "الموردين",
        qr: "Barcode",
        employees: "إدارة الموظفين"
    };

    let titleText = titles[section] || section;

    if (typeof CURRENT_SESSION !== 'undefined' && CURRENT_SESSION) {
        const loginDate = new Date(CURRENT_SESSION.login_at);
        const formattedDate = loginDate.toLocaleDateString('ar-EG');
        const formattedTime = loginDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

        pageTitle.innerHTML = `${titleText} <span style="font-size: 14px; color: var(--gray); font-weight: normal; margin-right: 15px; border-right: 1px solid #ccc; padding-right: 15px;">المستخدم: ${CURRENT_SESSION.name} | دخول: ${formattedDate} ${formattedTime}</span>`;
    } else {
        pageTitle.textContent = titleText;
    }
    currentSection = section;

    // إيقاف ماسح QR إذا انتقلنا بعيداً عن قسم الدفع
    if (section !== "checkout") {
        stopQRScanner();
    }

    // إذا كان قسم الموردين، قم بتحميل جدول الموردين
    if (section === "suppliers") {
        loadSuppliersTable();
    }
    // إذا كان قسم الموظفين
    if (section === "employees") {
        loadEmployeesTable();
    }
    // Online Orders
    if (section === "online-orders") {
        loadOnlineOrders();
    }
    // Customers
    if (section === "customers") {
        loadCustomersStats();
    }
}

// تحميل جدول المنتجات مع إمكانية تعديل المخزون
async function loadProductsTable() {
    try {
        const response = await fetch(`${API_URL}/products`);
        const products = await response.json();

        productsTable.innerHTML = "";

        products.forEach(product => {
            const status = getStockStatus(product.stock);
            const statusClass = `status-${status}`;

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${product.id}</td>
                <td>
                    <div style="display: flex; align-items: center;">
                        <div style="width: 40px; height: 40px; border-radius: 8px; overflow: hidden; margin-left: 12px; background: #f1f5f9;">
                            <img src="${product.image || 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=400'}" alt="${product.name}" style="width: 100%; height: 200%; object-fit: cover;">
                        </div>
                        <div>
                            <div style="font-weight: 600; color: var(--dark);">${product.name}</div>
                            <div style="font-size: 13px; color: var(--gray);">${product.description || ''}</div>
                        </div>
                    </div>
                </td>
                <td>${formatCategory(product.category)}</td>
                <td>${product.size}</td>
                <td>
                    <div style="display: flex; align-items: center;">
                        <div style="width: 16px; height: 16px; border-radius: 50%; background: ${getColorHex(product.color)}; margin-left: 8px; border: 1px solid var(--glass-border);"></div>
                        ${product.color}
                    </div>
                </td>
                <td>${formatPrice(product.price)}</td>
                <td>
                    ${editingStockProductId === product.id ?
                    `<div style="display: flex; align-items: center;">
                            <input type="number" class="stock-input" id="stock-edit-${product.id}" value="${product.stock}" min="0">
                            <button class="stock-save-btn" onclick="saveStock('${product.id}')">حفظ</button>
                            <button class="btn btn-sm btn-outline" onclick="cancelStockEdit()" style="margin-right: 5px; padding: 6px 10px;">إلغاء</button>
                        </div>` :
                    `<div style="display: flex; align-items: center;">
                            <span>${product.stock}</span>
                            <button class="action-btn" onclick="editStock('${product.id}')" style="margin-right: 8px;">
                                <i class="fas fa-edit"></i>
                            </button>
                        </div>`
                }
                </td>
                <td><span class="status ${statusClass}">${formatStatus(status)}</span></td>
                <td>
                    <div class="action-buttons">
                        <div class="action-btn" title="تعديل" onclick="editProduct('${product.id}')">
                            <i class="fas fa-edit"></i>
                        </div>
                        <div class="action-btn" title="حذف" onclick="deleteProduct('${product.id}')">
                            <i class="fas fa-trash"></i>
                        </div>
                        </div>
                    </div>
                </td>
            `;

            productsTable.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading products:', error);
        alert('حدث خطأ في تحميل المنتجات');
    }
}

// تعديل كمية المخزون
function editStock(productId) {
    editingStockProductId = productId;
    loadProductsTable();
}

// حفظ تغييرات المخزون
async function saveStock(productId) {
    const stockInput = document.getElementById(`stock-edit-${productId}`);
    const newStock = parseInt(stockInput.value);

    if (isNaN(newStock) || newStock < 0) {
        alert("الرجاء إدخال كمية مخزون صالحة");
        return;
    }

    try {
        const response = await fetch(`${API_URL}/products/${productId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ stock: newStock })
        });

        if (response.ok) {
            editingStockProductId = null;
            await loadProductsTable();
            await updateDashboardStats();
            alert(`تم تحديث المخزون بنجاح`);
        } else {
            throw new Error('فشل تحديث المخزون');
        }
    } catch (error) {
        console.error('Error updating stock:', error);
        alert('حدث خطأ في تحديث المخزون');
    }
}

// إلغاء تعديل المخزون
function cancelStockEdit() {
    editingStockProductId = null;
    loadProductsTable();
}

// تحميل المبيعات الأخيرة مع أسماء العملاء
async function loadRecentSales() {
    try {
        const response = await fetch(`${API_URL}/sales/recent`);
        const sales = await response.json();

        recentSales.innerHTML = "";

        if (sales.length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--gray);">
                    <i class="fas fa-shopping-bag" style="font-size: 32px; margin-bottom: 16px; display: block;"></i>
                    <p>لا توجد مبيعات حتى الآن. أكمل أول عملية بيع لرؤيتها هنا.</p>
                </td>
            `;
            recentSales.appendChild(row);
            return;
        }

        sales.forEach(sale => {
            const itemsCount = sale.items_count || 0;
            const itemsText = itemsCount === 1 ? "منتج واحد" : `${itemsCount} منتجات`;

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${sale.id}</td>
                <td>${sale.customer || 'عميل متجر'}</td>
                <td>${itemsText}</td>
                <td>${formatPrice(sale.total)}</td>
                <td>${formatPaymentMethod(sale.payment_method)}</td>
                <td>${formatDateTime(sale.created_at)}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="reprintInvoice(${sale.id})" title="إعادة طباعة">
                        <i class="fas fa-print"></i>
                    </button>
                </td>
            `;

            recentSales.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading sales:', error);
        recentSales.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--danger);">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>حدث خطأ في تحميل المبيعات</p>
                </td>
            </tr>
        `;
    }
}

// تحميل سجلات النشاط
async function loadActivityLogs() {
    try {
        const response = await fetch(`${API_URL}/logs/recent`);
        const logs = await response.json();

        activityLogs.innerHTML = "";

        if (logs.length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td colspan="4" style="text-align: center; padding: 40px; color: var(--gray);">
                    <i class="fas fa-clipboard-list" style="font-size: 32px; margin-bottom: 16px; display: block;"></i>
                    <p>لا توجد سجلات نشاط حتى الآن.</p>
                </td>
            `;
            activityLogs.appendChild(row);
            return;
        }

        logs.forEach(log => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${formatDateTime(log.timestamp)}</td>
                <td>${log.user}</td>
                <td>${log.action}</td>
                <td>${log.details}</td>
            `;

            activityLogs.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading logs:', error);
    }
}

// تحميل طرق الدفع
async function loadPaymentMethods() {
    try {
        const response = await fetch(`${API_URL}/payment-methods`);
        const paymentMethods = await response.json();

        // تحديث قائمة طرق الدفع
        paymentMethodsList.innerHTML = "";

        paymentMethods.forEach(payment => {
            const paymentCard = document.createElement("div");
            paymentCard.className = "payment-method-card";
            paymentCard.innerHTML = `
                <div class="payment-method-header">
                    <div class="payment-method-name">
                        <i class="fas fa-${getPaymentIcon(payment.type)}" style="color: ${getPaymentColor(payment.type)};"></i>
                        <span>${payment.name}</span>
                    </div>
                    <div class="payment-status status-${payment.status}">${payment.status === 'enabled' ? 'مفعل' : 'معطل'}</div>
                </div>
                <div style="color: var(--gray); font-size: 14px; margin-bottom: 12px;">
                    ${payment.description}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-size: 14px; color: var(--gray);">الرسوم: ${payment.fee}%</span>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-outline" onclick="configurePayment('${payment.id}')">
                            <i class="fas fa-cog"></i> تعديل
                        </button>
                    </div>
                </div>
            `;

            paymentMethodsList.appendChild(paymentCard);
        });

        // تحديث قائمة طرق الدفع في قسم الدفع
        updatePaymentMethodDropdown(paymentMethods);
    } catch (error) {
        console.error('Error loading payment methods:', error);
    }
}

// تحديث قائمة طرق الدفع المنسدلة
function updatePaymentMethodDropdown(paymentMethods = []) {
    paymentMethodSelect.innerHTML = "";

    const enabledMethods = paymentMethods.filter(p => p.status === 'enabled');

    enabledMethods.forEach(payment => {
        const option = document.createElement("option");
        option.value = payment.id;
        option.textContent = payment.name;
        paymentMethodSelect.appendChild(option);
    });
}

// تحديث إحصائيات لوحة التحكم ببيانات حقيقية
async function updateDashboardStats() {
    try {
        const response = await fetch(`${API_URL}/dashboard/stats`);
        const stats = await response.json();

        // تحديث عناصر DOM
        document.getElementById("total-products").textContent = stats.total_products || 0;
        document.getElementById("low-stock").textContent = stats.low_stock || 0;
        document.getElementById("today-sales").textContent = formatPrice(stats.today_sales || 0);
        document.getElementById("monthly-revenue").textContent = formatPrice(stats.monthly_revenue || 0);

        // تحديث مؤشرات التغيير
        document.getElementById("products-change").textContent = stats.products_added_today > 0 ? `+${stats.products_added_today} اليوم` : `+0 اليوم`;
        document.getElementById("sales-change").textContent = stats.today_sales_count > 0 ? `+${stats.today_sales_count} مبيعات اليوم` : "لا توجد مبيعات اليوم";

        if (stats.today_sales_count > 0) {
            document.getElementById("sales-change").className = "card-change positive";
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

// Reset dashboard markers (day/month) - Marker Reset + خيار حذف الفواتير
async function handleDashboardReset(period) {
    if (!CURRENT_SESSION || (CURRENT_SESSION.role || '').toLowerCase() !== 'admin') {
        showAccessDenied();
        return;
    }

    const msg =
        `Marker Reset (${period})\n` +
        `1) تصفير الفلوس بس\n` +
        `2) تصفير الفلوس + حذف الفواتير (هيتم حذف فواتير + items)\n\n` +
        `اكتب 1 أو 2`;
    const choice = (prompt(msg) || '').trim();
    if (!choice) return;
    const delete_invoices = choice === '2';
    if (choice !== '1' && choice !== '2') {
        alert('اختيار غير صحيح');
        return;
    }

    const sure = confirm(delete_invoices ? 'تأكيد: هتحذف الفواتير كمان؟' : 'تأكيد: هتصفّر الفلوس بس؟');
    if (!sure) return;

    const endpoint = period === 'month' ? '/dashboard/reset-month' : '/dashboard/reset-day';

    try {
        const r = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delete_invoices }),
        });
        if (!r.ok) throw new Error('reset failed');
        await updateDashboardStats();
        await loadRecentSales();
        alert('تم التصفير بنجاح');
    } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء التصفير');
    }
}

// حذف المخزون بالكامل (تصفير stock لكل المنتجات)
async function handleClearStock() {
    if (!CURRENT_SESSION || (CURRENT_SESSION.role || '').toLowerCase() !== 'admin') {
        showAccessDenied();
        return;
    }
    const ok = confirm('تأكيد: هل تريد تصفير المخزون لكل المنتجات؟');
    if (!ok) return;
    try {
        const r = await fetch(`${API_URL}/products/clear-stock`, { method: 'POST' });
        if (!r.ok) throw new Error('clear stock failed');
        await loadProductsTable();
        await updateDashboardStats();
        alert('تم تصفير المخزون');
    } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء تصفير المخزون');
    }
}

// فتح نافذة المنتج للإضافة/التعديل
function openProductModal(productId = null) {
    const modalTitle = document.getElementById("modal-product-title");
    const form = document.getElementById("product-form");

    if (productId) {
        // وضع التعديل - جلب بيانات المنتج من السيرفر
        loadProductForEdit(productId);
    } else {
        // وضع الإضافة
        modalTitle.textContent = "إضافة منتج جديد";
        form.reset();
        document.getElementById("product-id").value = "";
        productModal.classList.add("active");
    }
}

// جلب بيانات المنتج للتعديل
async function loadProductForEdit(productId) {
    try {
        const response = await fetch(`${API_URL}/products/${productId}`);
        if (!response.ok) throw new Error('Product not found');

        const product = await response.json();

        const modalTitle = document.getElementById("modal-product-title");
        modalTitle.textContent = "تعديل المنتج";

        document.getElementById("product-id").value = product.id;
        document.getElementById("product-name").value = product.name;
        document.getElementById("product-category").value = product.category;
        document.getElementById("product-price").value = product.price;
        document.getElementById("product-stock").value = product.stock;
        document.getElementById("product-barcode").value = product.barcode || '';
        document.getElementById("product-supplier-barcode").value = product.supplier_barcode || '';
        document.getElementById("product-size").value = product.size;
        document.getElementById("product-color").value = product.color;
        document.getElementById("product-description").value = product.description || '';
        document.getElementById("product-image").value = product.image || '';

        productModal.classList.add("active");
    } catch (error) {
        console.error('Error loading product for edit:', error);
        alert('حدث خطأ في تحميل بيانات المنتج');
    }
}

// حفظ المنتج (إضافة أو تعديل)
async function saveProduct() {
    const id = document.getElementById("product-id").value;
    const name = document.getElementById("product-name").value;
    const category = document.getElementById("product-category").value;
    const price = parseFloat(document.getElementById("product-price").value);
    const stock = parseInt(document.getElementById("product-stock").value);
    const barcode = (document.getElementById("product-barcode").value || '').trim();
    const supplier_barcode = (document.getElementById("product-supplier-barcode").value || '').trim();
    const size = document.getElementById("product-size").value;
    const color = document.getElementById("product-color").value;
    const description = document.getElementById("product-description").value;
    const image = document.getElementById("product-image").value || "https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=400";

    const productData = {
        name,
        category,
        price,
        stock,
        barcode,
        supplier_barcode,
        size,
        color,
        description,
        image
    };

    if (!barcode) {
        alert('من فضلك اكتب باركود المنتج');
        return;
    }

    try {
        let response;

        if (id) {
            // تعديل منتج موجود
            response = await fetch(`${API_URL}/products/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(productData)
            });
        } else {
            // إضافة منتج جديد
            response = await fetch(`${API_URL}/products`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(productData)
            });
        }

        if (response.ok) {
            // تحديث الواجهة
            await loadProductsTable();
            await updateDashboardStats();

            // إغلاق النافذة وإعادة تعيين النموذج
            productModal.classList.remove("active");
            productForm.reset();

            alert(`تم ${id ? 'تحديث' : 'إضافة'} المنتج "${name}" بنجاح`);

            // إضافة سجل
            await addLog("المسؤول", id ? "تعديل المنتج" : "إضافة منتج", `تم ${id ? 'تعديل' : 'إضافة'} المنتج "${name}"`);
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'فشل حفظ المنتج');
        }
    } catch (error) {
        console.error('Error saving product:', error);
        alert(`حدث خطأ في حفظ المنتج: ${error.message}`);
    }
}

// تعديل المنتج
function editProduct(productId) {
    openProductModal(productId);
}

// حذف المنتج
async function deleteProduct(productId) {
    const product = await getProductById(productId);
    if (!product) return;

    if (confirm(`هل أنت متأكد أنك تريد حذف "${product.name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) {
        try {
            const response = await fetch(`${API_URL}/products/${productId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                // تحديث الواجهة
                await loadProductsTable();
                await updateDashboardStats();

                // إضافة سجل
                await addLog("المسؤول", "حذف المنتج", `تم حذف المنتج "${product.name}" (${productId})`);

                alert(`تم حذف المنتج "${product.name}" بنجاح.`);
            } else {
                throw new Error('فشل حذف المنتج');
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            alert('حدث خطأ في حذف المنتج');
        }
    }
}

// جلب منتج بالمعرف
async function getProductById(productId) {
    try {
        const response = await fetch(`${API_URL}/products/${productId}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('Error getting product:', error);
        return null;
    }
}

// تكوين طريقة الدفع
async function configurePayment(paymentId) {
    try {
        const response = await fetch(`${API_URL}/payment-methods/${paymentId}`);
        if (!response.ok) throw new Error('Payment method not found');

        const payment = await response.json();

        editingPaymentId = paymentId;

        document.getElementById("edit-payment-id").value = payment.id;
        document.getElementById("edit-payment-name").value = payment.name;
        document.getElementById("edit-payment-type").value = payment.type;
        document.getElementById("edit-payment-status").value = payment.status;
        document.getElementById("edit-payment-fee").value = payment.fee;
        document.getElementById("edit-payment-description").value = payment.description || '';

        editPaymentModal.classList.add("active");
    } catch (error) {
        console.error('Error loading payment method:', error);
        alert('حدث خطأ في تحميل طريقة الدفع');
    }
}

// حفظ تغييرات طريقة الدفع
async function savePaymentMethod() {
    const paymentId = document.getElementById("edit-payment-id").value;
    const name = document.getElementById("edit-payment-name").value;
    const type = document.getElementById("edit-payment-type").value;
    const status = document.getElementById("edit-payment-status").value;
    const fee = parseFloat(document.getElementById("edit-payment-fee").value) || 0;
    const description = document.getElementById("edit-payment-description").value;

    const paymentData = {
        name,
        type,
        status,
        fee,
        description
    };

    try {
        const response = await fetch(`${API_URL}/payment-methods/${paymentId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(paymentData)
        });

        if (response.ok) {
            // تحديث الواجهة
            await loadPaymentMethods();
            editPaymentModal.classList.remove("active");
            editingPaymentId = null;

            await addLog("المسؤول", "تحديث طريقة الدفع", `تم تحديث طريقة الدفع "${name}"`);

            alert(`تم تحديث طريقة الدفع "${name}" بنجاح`);
        } else {
            throw new Error('فشل تحديث طريقة الدفع');
        }
    } catch (error) {
        console.error('Error saving payment method:', error);
        alert('حدث خطأ في تحديث طريقة الدفع');
    }
}

// حذف طريقة الدفع
async function deletePaymentMethod() {
    if (!editingPaymentId) return;

    try {
        const response = await fetch(`${API_URL}/payment-methods/${editingPaymentId}`);
        if (!response.ok) throw new Error('Payment method not found');

        const payment = await response.json();

        if (confirm(`هل أنت متأكد أنك تريد حذف طريقة الدفع "${payment.name}"؟`)) {
            const deleteResponse = await fetch(`${API_URL}/payment-methods/${editingPaymentId}`, {
                method: 'DELETE'
            });

            if (deleteResponse.ok) {
                // تحديث الواجهة
                await loadPaymentMethods();
                editPaymentModal.classList.remove("active");
                editingPaymentId = null;

                await addLog("المسؤول", "حذف طريقة الدفع", `تم حذف طريقة الدفع "${payment.name}"`);

                alert(`تم حذف طريقة الدفع "${payment.name}" بنجاح`);
            } else {
                throw new Error('فشل حذف طريقة الدفع');
            }
        }
    } catch (error) {
        console.error('Error deleting payment method:', error);
        alert('حدث خطأ في حذف طريقة الدفع');
    }
}

// إضافة طريقة دفع جديدة
async function addPaymentMethod() {
    const name = document.getElementById("payment-name").value;
    const type = document.getElementById("payment-type").value;
    const status = document.getElementById("payment-status").value;

    if (!name.trim()) {
        alert("الرجاء إدخال اسم طريقة الدفع");
        return;
    }

    const paymentData = {
        name,
        type,
        status,
        fee: 0,
        description: `طريقة الدفع ${name}`
    };

    try {
        const response = await fetch(`${API_URL}/payment-methods`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(paymentData)
        });

        if (response.ok) {
            // تحديث الواجهة
            await loadPaymentMethods();

            // مسح النموذج
            document.getElementById("payment-name").value = "";

            await addLog("المسؤول", "إضافة طريقة دفع", `تم إضافة طريقة دفع جديدة "${name}"`);

            alert(`تم إضافة طريقة الدفع "${name}" بنجاح`);
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'فشل إضافة طريقة الدفع');
        }
    } catch (error) {
        console.error('Error adding payment method:', error);
        alert(`حدث خطأ في إضافة طريقة الدفع: ${error.message}`);
    }
}

// إضافة خيار مقاس جديد
function addSizeOption() {
    const category = document.getElementById("size-category").value;
    const value = document.getElementById("size-value").value;
    const description = document.getElementById("size-description").value;

    if (!value.trim()) {
        alert("الرجاء إدخال قيمة المقاس");
        return;
    }

    addLog("المسؤول", "إضافة مقاس", `تم إضافة المقاس "${value}" (${description}) إلى فئة ${category}`);

    // مسح النموذج
    document.getElementById("size-value").value = "";
    document.getElementById("size-description").value = "";

    alert(`تم إضافة المقاس "${value}" إلى فئة ${category}`);
}

// بدء ماسح QR
function startQRScanner() {
    qrScannerContainer.style.display = "block";

    // تعليمات للمستخدم (QR Scanner devices تعمل ككيبورد وتبعت Enter في الآخر)
    document.getElementById("qr-reader-results").innerHTML = `
        <div style="background: rgba(124,58,237,0.08); border: 1px dashed rgba(124,58,237,0.35); padding: 14px; border-radius: 10px; margin-top: 12px;">
            <div style="font-weight:700; color: var(--dark);">
                <i class="fas fa-keyboard"></i> وضع الماسح (Scanner Mode)
            </div>
            <div style="color: var(--gray); margin-top: 6px; line-height: 1.7;">
                لو عندك جهاز QR/Barcode Scanner: وجّه الماسح للكود، وسيتم إضافة المنتج تلقائيًا.<br/>
                <b>ملاحظة:</b> يجب عليك اولاً الضغط على البحث ثم توجيه الماسح.<br/>
            </div>
        </div>
    `;

    enableScannerMode();
}

function stopQRScanner() {
    disableScannerMode();
    qrScannerContainer.style.display = "none";
    document.getElementById("qr-reader-results").innerHTML = "";
}

// ==============================
// Scanner Mode (Keyboard Wedge)
// ==============================
let SCAN_ACTIVE = false;
let SCAN_BUFFER = "";
let LAST_KEY_TIME = 0;

function enableScannerMode() {
    if (SCAN_ACTIVE) return;
    SCAN_ACTIVE = true;
    SCAN_BUFFER = "";
    LAST_KEY_TIME = 0;
    document.addEventListener("keydown", onScannerKeyDown, true);
}

function disableScannerMode() {
    if (!SCAN_ACTIVE) return;
    SCAN_ACTIVE = false;
    SCAN_BUFFER = "";
    LAST_KEY_TIME = 0;
    document.removeEventListener("keydown", onScannerKeyDown, true);
}

async function onScannerKeyDown(e) {
    if (!SCAN_ACTIVE) return;

    // تجاهل لو المستخدم بيكتب في input/textarea يدوي
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    const isTypingField = tag === "input" || tag === "textarea" || e.target.isContentEditable;

    // لو المستخدم بيكتب يدويًا، مانلتقطش إلا إذا كان في وضع الماسح وداخل منطقة الماسح
    // (جهاز السكانر عادة يكتب حتى لو focus في أي مكان — فهنعتمد على سرعة الإدخال)
    const now = Date.now();
    const delta = LAST_KEY_TIME ? (now - LAST_KEY_TIME) : 0;
    LAST_KEY_TIME = now;

    // Enter = نهاية مسح
    if (e.key === "Enter") {
        const code = SCAN_BUFFER.trim();
        SCAN_BUFFER = "";

        // لو الكود فاضي، سيب
        if (!code) return;

        // لو المستخدم كان بيكتب ببطء (مش scanner) تجاهل
        // scanner بيبعت أحرف بسرعة جدًا (أقل من ~60ms)
        if (delta > 120 && isTypingField) {
            return;
        }

        await handleScannedCode(code);
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // Backspace يمسح
    if (e.key === "Backspace") {
        SCAN_BUFFER = SCAN_BUFFER.slice(0, -1);
        return;
    }

    // نجمع الأحرف القابلة للطباعة فقط
    if (e.key && e.key.length === 1) {
        // لو بطيء جدًا وفي input -> غالبًا كتابة يدوي، تجاهل
        if (delta > 120 && isTypingField) return;
        SCAN_BUFFER += e.key;
    }
}

async function handleScannedCode(rawCode) {
    const resultsEl = document.getElementById("qr-reader-results");
    const code = String(rawCode).trim();

    try {
        let added = false;

        // 1) لو أرقام فقط -> اعتبره ID
        if (/^\d+$/.test(code)) {
            const id = parseInt(code, 10);
            const product = await getProductById(id);
            if (product && product.id) {
                await addToCart(product.id);
                added = true;
            }
        }

        // 2) لو مش ID أو لم يتم العثور -> حاول search
        if (!added) {
            const resp = await fetch(`${API_URL}/products/search?q=${encodeURIComponent(code)}`);
            const matches = await resp.json();

            if (Array.isArray(matches) && matches.length > 0) {
                // لو فيه نتائج، اختار أول نتيجة (أقرب تطابق)
                await addToCart(matches[0].id);
                added = true;
            }
        }

        if (added) {
            resultsEl.innerHTML = `
                <div style="color: var(--success); font-weight: 700; margin-top: 12px;">
                    <i class="fas fa-check-circle"></i> تم إضافة المنتج من الكود: <span style="direction:ltr;">${escapeHtml(code)}</span>
                </div>
            `;
        } else {
            resultsEl.innerHTML = `
                <div style="color: var(--danger); font-weight: 700; margin-top: 12px;">
                    <i class="fas fa-times-circle"></i> الكود غير مطابق لأي منتج: <span style="direction:ltr;">${escapeHtml(code)}</span>
                </div>
            `;
        }

        setTimeout(() => {
            if (SCAN_ACTIVE) resultsEl.innerHTML = "";
        }, 2500);
    } catch (err) {
        console.error("Scan error:", err);
        resultsEl.innerHTML = `
            <div style="color: var(--danger); font-weight: 700; margin-top: 12px;">
                <i class="fas fa-exclamation-triangle"></i> حدث خطأ أثناء قراءة الكود
            </div>
        `;
    }
}

// helper for safe HTML output
function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


// ==============================
// Barcode helpers (Real scannable CODE128)
// ==============================
function sanitizeBarcodePart(x) {
    return String(x || "")
        .trim()
        .replace(/\s+/g, "")         // remove spaces
        .replace(/[^0-9A-Za-z_-]/g, ""); // keep safe chars
}

// تكوين باركود نهائي لكل (مقاس + لون) من باركود أساسي
function generateVariantBarcode(baseBarcode, size, color) {
    const b = sanitizeBarcodePart(baseBarcode);
    const s = sanitizeBarcodePart(size);
    const c = sanitizeBarcodePart(color);
    // Code128 يدعم الحروف والأرقام والـ "-" لذلك الشكل ده قابل للقراءة بالسكانر
    return `${b}-${s}-${c}`;
}



// البحث عن المنتج يدوياً
async function searchProduct() {
    const query = searchProductInput.value.toLowerCase().trim();
    if (!query) return;

    searchResults.innerHTML = "";

    try {
        const response = await fetch(`${API_URL}/products/search?q=${encodeURIComponent(query)}`);
        const matches = await response.json();

        if (matches.length === 0) {
            searchResults.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--gray);">
                    <i class="fas fa-search" style="font-size: 24px; margin-bottom: 10px;"></i>
                    <p>لم يتم العثور على منتجات تطابق "${query}"</p>
                </div>
            `;
            return;
        }

        matches.forEach(product => {
            const productEl = document.createElement("div");
            productEl.className = "cart-item";
            productEl.innerHTML = `
                <div class="cart-item-info">
                    <h4>${product.name}</h4>
                    <p>رقم: ${product.id} | المقاس: ${product.size} | اللون: ${product.color}</p>
                    <p>السعر: ${formatPrice(product.price)} | المخزون: ${product.stock}</p>
                </div>
                <button class="btn btn-primary" onclick="addToCart('${product.id}')">
                    <i class="fas fa-plus"></i> إضافة إلى العربة
                </button>
            `;

            searchResults.appendChild(productEl);
        });
    } catch (error) {
        console.error('Error searching products:', error);
        searchResults.innerHTML = `
            <div style="color: var(--danger); padding: 20px; text-align: center;">
                <i class="fas fa-exclamation-triangle"></i>
                <p>حدث خطأ في البحث</p>
            </div>
        `;
    }
}

// إضافة منتج إلى العربة
async function addToCart(productId) {
    try {
        const product = await getProductById(productId);
        if (!product) {
            alert("المنتج غير موجود");
            return;
        }

        if (product.stock <= 0) {
            alert(`عذراً، "${product.name}" غير متوفر في المخزون.`);
            return;
        }

        // التحقق مما إذا كان موجوداً بالفعل في العربة
        const existingItem = cart.find(item => item.id === productId);

        if (existingItem) {
            if (existingItem.quantity >= product.stock) {
                alert(`لا يمكن إضافة المزيد من "${product.name}". يوجد فقط ${product.stock} متوفر في المخزون.`);
                return;
            }
            existingItem.quantity += 1;
        } else {
            cart.push({
                id: product.id,
                name: product.name,
                price: product.price,
                size: product.size,
                color: product.color,
                quantity: 1
            });
        }

        // تحديث عرض العربة
        updateCartDisplay();

        // إغلاق نافذة الإضافة اليدوية إذا كانت مفتوحة
        manualAddModal.classList.remove("active");
        searchProductInput.value = "";
        searchResults.innerHTML = "";
    } catch (error) {
        console.error('Error adding to cart:', error);
        alert('حدث خطأ في إضافة المنتج إلى العربة');
    }
}

// تحديث عرض العربة
function updateCartDisplay() {
    if (cart.length === 0) {
        cartItemsList.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--gray);">
                <i class="fas fa-shopping-cart" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p>عربة التسوق فارغة. امسح أو أضف منتجات للبدء.</p>
            </div>
        `;

        subtotalEl.textContent = "0.00 ج.م";
        taxEl.textContent = "0.00 ج.م";
        if (discountEl) discountEl.textContent = "0.00 ج.م";
        totalEl.textContent = "0.00 ج.م";
        totalAmountEl.textContent = "0.00";

        return;
    }

    // بناء عناصر العربة
    cartItemsList.innerHTML = "";

    cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;

        const itemEl = document.createElement("div");
        itemEl.className = "cart-item";
        itemEl.innerHTML = `
            <div class="cart-item-info">
                <h4>${item.name}</h4>
                <p>المقاس: ${item.size} | اللون: ${item.color}</p>
                <p>${formatPrice(item.price)} لكل قطعة</p>
            </div>
            <div class="cart-item-quantity">
                <div class="quantity-btn" onclick="updateCartQuantity(${index}, -1)">
                    <i class="fas fa-minus"></i>
                </div>
                <span style="font-weight: 600; color: var(--dark); min-width: 30px; text-align: center;">${item.quantity}</span>
                <div class="quantity-btn" onclick="updateCartQuantity(${index}, 1)">
                    <i class="fas fa-plus"></i>
                </div>
                <span style="font-weight: 600; color: var(--dark); margin-right: 20px; min-width: 80px; text-align: left;">
                    ${formatPrice(itemTotal)}
                </span>
                <div class="action-btn" onclick="removeFromCart(${index})" style="margin-right: 10px;">
                    <i class="fas fa-times"></i>
                </div>
            </div>
        `;

        cartItemsList.appendChild(itemEl);
    });

    // حساب الإجماليات
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = computeTax(subtotal); // ضريبة
    const discountValue = Math.max(0, Number(discountInput?.value) || 0);
    const total = Math.max(0, subtotal + tax - discountValue);

    subtotalEl.textContent = formatPrice(subtotal);
    taxEl.textContent = formatPrice(tax);
    if (discountEl) discountEl.textContent = formatPrice(discountValue);
    totalEl.textContent = formatPrice(total);
    totalAmountEl.textContent = total.toFixed(2);
}

// تحديث كمية عنصر في العربة
function updateCartQuantity(index, change) {
    const newQuantity = cart[index].quantity + change;

    if (newQuantity < 1) {
        removeFromCart(index);
        return;
    }

    cart[index].quantity = newQuantity;
    updateCartDisplay();
}

// إزالة عنصر من العربة
function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartDisplay();
}

// تفريغ العربة
function clearCart() {
    if (cart.length === 0) return;

    if (confirm("هل أنت متأكد أنك تريد تفريغ العربة؟")) {
        cart = [];
        updateCartDisplay();
    }
}

// إتمام عملية البيع
async function completeSale() {
    if (cart.length === 0) {
        alert("العربة فارغة. أضف منتجات قبل إتمام البيع.");
        return;
    }

    const paymentMethodId = paymentMethodSelect.value;
    const paymentMethod = await getPaymentMethodById(paymentMethodId);
    const customerName = customerNameInput.value || "عميل متجر";

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = computeTax(subtotal); // ضريبة
    const discountValue = Math.max(0, Number(discountInput?.value) || 0); // جنيه
    const total = Math.max(0, subtotal + tax - discountValue);

    // التحقق من المخزون قبل إتمام البيع
    for (const item of cart) {
        const product = await getProductById(item.id);
        if (product && product.stock < item.quantity) {
            alert(`مخزون غير كافٍ لـ "${product.name}". يوجد فقط ${product.stock} متوفر، ولكن ${item.quantity} مطلوب.`);
            return;
        }
    }

    // إنشاء بيانات عملية البيع
    const saleData = {
        customer: customerName,
        cashier_name: cashierNameInput ? cashierNameInput.value : (CURRENT_SESSION?.name || null),
        discount: discountValue,
        items: cart.map(item => ({
            product_id: item.id,
            product_name: item.name,
            quantity: item.quantity,
            price: item.price
        })),
        subtotal: subtotal,
        tax: tax,
        total: total,
        payment_method: paymentMethod ? paymentMethod.name : "كاش",
        payment_method_id: paymentMethodId
    };

    try {
        const response = await fetch(`${API_URL}/sales`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(saleData)
        });

        if (response.ok) {
            const sale = await response.json();

            // المخزون يتم تحديثه في الباك إند داخل /sales
            // (تجنب تكرار الخصم وتجنب إرسال PUT جزئي قد يسبب NULL)

            // إضافة سجل
            await addLog("المسؤول", "إتمام البيع", `عملية البيع رقم ${sale.id} - ${formatPrice(total)} - العميل: ${customerName}`);

            // تحديث الواجهة
            await loadProductsTable();
            await loadRecentSales();
            await updateDashboardStats();

            // إنشاء الفاتورة
            generateReceipt(sale, paymentMethod);

            // تفريغ العربة
            cart = [];
            updateCartDisplay();

            // إعادة تعيين اسم العميل
            customerNameInput.value = "عميل متجر";

            // عرض نافذة الفاتورة
            receiptModal.classList.add("active");

            alert(`تم إتمام عملية البيع رقم ${sale.id} بنجاح`);
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'فشل إتمام عملية البيع');
        }
    } catch (error) {
        console.error('Error completing sale:', error);
        alert(`حدث خطأ في إتمام عملية البيع: ${error.message}`);
    }
}

// تحديث المخزون بعد البيع
async function updateStockAfterSale(cartItems) {
    for (const item of cartItems) {
        const product = await getProductById(item.id);
        if (product) {
            const newStock = product.stock - item.quantity;
            await fetch(`${API_URL}/products/${item.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ stock: newStock })
            });
        }
    }
}

// جلب طريقة الدفع بالمعرف
async function getPaymentMethodById(paymentMethodId) {
    try {
        const response = await fetch(`${API_URL}/payment-methods/${paymentMethodId}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('Error getting payment method:', error);
        return null;
    }
}

// إنشاء الفاتورة
function generateReceipt(sale, paymentMethod) {
    // تحديث معلومات الفاتورة
    document.getElementById("receipt-number").textContent = sale.id;
    document.getElementById("receipt-customer").textContent = sale.customer;
    const cashierSpan = document.getElementById("receipt-cashier");
    if (cashierSpan) cashierSpan.textContent = sale.cashier_name || CURRENT_SESSION?.name || "-";

    // تحديث عناصر الفاتورة
    const receiptItems = document.getElementById("receipt-items");
    receiptItems.innerHTML = "";

    sale.items.forEach(item => {
        const itemTotal = item.price * item.quantity;

        const itemEl = document.createElement("div");
        itemEl.className = "receipt-item";
        itemEl.innerHTML = `
            <span>${item.product_name} (${item.quantity}x ${formatPrice(item.price)})</span>
            <span>${formatPrice(itemTotal)}</span>
        `;

        receiptItems.appendChild(itemEl);
    });

    // إضافة الملخص
    const summaryEl = document.createElement("div");
    summaryEl.innerHTML = `
        <div class="receipt-item">
            <span>المجموع الجزئي:</span>
            <span>${formatPrice(sale.subtotal)}</span>
        </div>
        <div class="receipt-item">
            <span>الضريبة ():</span>
            <span>${formatPrice(sale.tax)}</span>
        </div>
    `;
    receiptItems.appendChild(summaryEl);

    // تحديث الإجماليات
    const discountValue = Math.max(0, Number(sale.discount) || 0);
    const totalAfterDiscount = Math.max(0, Number(sale.total) || 0);
    const totalBeforeDiscount = totalAfterDiscount + discountValue;
    document.getElementById("receipt-total").textContent = formatPrice(totalBeforeDiscount);
    document.getElementById("receipt-discount").textContent = formatPrice(discountValue);
    document.getElementById("receipt-total-after-discount").textContent = formatPrice(totalAfterDiscount);
    document.getElementById("receipt-payment").textContent = sale.payment_method;
}

// طباعة الفاتورة
async function printReceipt() {
    if (cart.length === 0) {
        alert("العربة فارغة. لا يمكن طباعة الفاتورة.");
        return;
    }

    const paymentMethodId = paymentMethodSelect.value;
    const paymentMethod = await getPaymentMethodById(paymentMethodId);
    const customerName = customerNameInput.value || "عميل متجر";

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = computeTax(subtotal); // ضريبة
    const discountValue = Math.max(0, Number(discountInput?.value) || 0);
    const total = Math.max(0, subtotal + tax - discountValue);

    const sale = {
        id: "SF-" + Date.now().toString().slice(-6),
        customer: customerName,
        items: cart.map(item => ({
            product_id: item.id,
            product_name: item.name,
            quantity: item.quantity,
            price: item.price
        })),
        cashier_name: cashierNameInput ? cashierNameInput.value : (CURRENT_SESSION?.name || null),
        discount: discountValue,
        subtotal: subtotal,
        tax: tax,
        total: total,
        payment_method: paymentMethod ? paymentMethod.name : "كاش"
    };

    generateReceipt(sale, paymentMethod);
    receiptModal.classList.add("active");
}

// إضافة سجل
async function addLog(user, action, details) {
    const logEntry = {
        user: user,
        action: action,
        details: details
    };

    try {
        await fetch(`${API_URL}/logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(logEntry)
        });

        // تحديث السجلات إذا كنت في صفحة التقارير
        if (currentSection === "reports") {
            await loadActivityLogs();
        }
    } catch (error) {
        console.error('Error adding log:', error);
    }
}

// إنشاء تقرير
async function generateReport(type) {
    try {
        const response = await fetch(`${API_URL}/reports/${type}`);
        const report = await response.json();

        if (response.ok) {
            let reportContent = "";
            let reportTitle = "";

            switch (type) {
                case 'daily':
                    reportTitle = "تقرير المبيعات اليومي";
                    reportContent = `تقرير المبيعات اليومي - ${report.date}\n\n`;
                    reportContent += `إجمالي المبيعات: ${report.total_sales}\n`;
                    reportContent += `إجمالي الإيرادات: ${formatPrice(report.total_revenue)}\n\n`;
                    report.sales.forEach(sale => {
                        reportContent += `${sale.id} - ${sale.customer} - ${formatPrice(sale.total)}\n`;
                    });
                    break;

                case 'weekly':
                    reportTitle = "تقرير المبيعات الأسبوعي";
                    reportContent = `تقرير المبيعات الأسبوعي\n\n`;
                    reportContent += `إجمالي المبيعات: ${report.total_sales}\n`;
                    reportContent += `إجمالي الإيرادات: ${formatPrice(report.total_revenue)}\n`;
                    break;

                case 'monthly':
                    reportTitle = "تقرير المبيعات الشهري";
                    reportContent = `تقرير المبيعات الشهري - ${report.month}\n\n`;
                    reportContent += `إجمالي المبيعات: ${report.total_sales}\n`;
                    reportContent += `إجمالي الإيرادات: ${formatPrice(report.total_revenue)}\n`;
                    break;

                case 'inventory':
                    reportTitle = "تقرير المخزون";
                    reportContent = "تقرير المخزون\n\n";
                    report.products.forEach(product => {
                        const status = getStockStatus(product.stock);
                        reportContent += `${product.id} - ${product.name} - المخزون: ${product.stock} - الحالة: ${formatStatus(status)}\n`;
                    });
                    break;
            }

            // فتح نافذة قابلة للطباعة (يمكن حفظها PDF من المتصفح)
            const w = window.open("", "_blank");
            if (w) {
                w.document.open();
                w.document.write(`
                    <html><head>
                        <meta charset="UTF-8" />
                        <title>${reportTitle}</title>
                        <style>
                            body{font-family:Arial, sans-serif;direction:rtl;padding:24px}
                            h1{font-size:22px;margin:0 0 12px}
                            pre{white-space:pre-wrap;line-height:1.8;font-size:14px}
                            .hint{color:#64748b;font-size:12px;margin-bottom:16px}
                        </style>
                    </head><body>
                        <h1>${reportTitle}</h1>
                        <div class="hint">من نافذة الطباعة اختار Save as PDF</div>
                        <pre>${reportContent}</pre>
                        <script>window.print();</script>
                    </body></html>
                `);
                w.document.close();
            } else {
                alert(`${reportTitle}\n\n${reportContent}`);
            }

            await addLog("المسؤول", "إنشاء تقرير", `تم إنشاء تقرير ${type}`);
        }
    } catch (error) {
        console.error('Error generating report:', error);
        alert('حدث خطأ في إنشاء التقرير');
    }
}

// إغلاق جميع النوافذ المنبثقة
function closeAllModals() {
    document.querySelectorAll(".modal.active").forEach(m => m.classList.remove("active"));

    // إخفاء نماذج إضافية إن وجدت
    const salaryForm = document.getElementById("salary-form");
    if (salaryForm) salaryForm.style.display = "none";

    // إعادة تعيين حالات التعديل
    editingStockProductId = null;
    editingPaymentId = null;
}

// وظائف مساعدة
function getStockStatus(stock) {
    if (stock >= 20) return "in-stock";
    if (stock >= 5) return "low-stock";
    return "out-of-stock";
}

function formatStatus(status) {
    const statusMap = {
        "in-stock": "في المخزون",
        "low-stock": "مخزون منخفض",
        "out-of-stock": "غير متوفر"
    };
    return statusMap[status] || status;
}

function formatCategory(category) {
    const categoryMap = {
        "women": "نسائي",
        "men": "رجالي",
        "kids": "أطفال",
        "accessories": "إكسسوارات",
        "sportswear": "ملابس رياضية",
        "underwear": "ملابس داخلية",
        "outerwear": "ملابس خارجية",
    };
    return categoryMap[category] || category;
}

function formatPrice(price) {
    return parseFloat(price).toFixed(2) + " ج.م";
}

function getColorHex(color) {
    const colorMap = {
        "أسود": "#000000",
        "أزرق مزهر": "#3b82f6",
        "أحمر": "#ef4444",
        "أزرق غامق": "#1e3a8a",
        "أبيض": "#ffffff",
        "أخضر": "#10b981"
    };
    return colorMap[color] || "#94a3b8";
}

function getPaymentIcon(type) {
    const iconMap = {
        "cash": "money-bill-wave",
        "card": "credit-card",
        "digital": "mobile-alt",
        "bank": "university",
        "buy_now": "hand-holding-usd",
        "other": "money-check-alt"
    };
    return iconMap[type] || "money-check-alt";
}

function getPaymentColor(type) {
    const colorMap = {
        "cash": "#10b981",
        "card": "#7c3aed",
        "digital": "#0ea5e9",
        "bank": "#f59e0b",
        "buy_now": "#ec4899",
        "other": "#64748b"
    };
    return colorMap[type] || "#64748b";
}

function formatPaymentMethod(methodName) {
    return methodName || "كاش";
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
}

function formatDateTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleString('ar-EG', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getCurrentDateTime() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 16);
}

function updateReceiptDate() {
    const now = new Date();
    document.getElementById("receipt-date").textContent =
        `${now.toLocaleDateString('ar-EG', { month: 'long', day: 'numeric', year: 'numeric' })} ${now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
}

function generateId() {
    return 'id-' + Math.random().toString(36).substr(2, 9);
}

// إنشاء رمز QR للمنتج (عرض توضيحي)
function generateQRCode(productId) {
    // في التطبيق الحقيقي، سيتم إنشاء رمز QR
    alert(`رمز QR للمنتج ${productId}\n\nيمكن مسح هذا الرمز في الدفع لإضافة هذا المنتج بسرعة إلى العربة.`);
}

// ==============================
// Barcode generator (ID-based)
// Format: SP26-<10 digits>
// ==============================
function formatBarcodeValue(productId) {
    // fallback فقط لو المنتج ملوش باركود
    const n = String(productId).replace(/\D/g, "");
    const padded = n.padStart(10, "0").slice(-10);
    return `SP26-${padded}`;
}


function generateBarcode() {
    const inputEl = document.getElementById('barcodeInput');
    const canvasEl = document.getElementById('barcodeCanvas');
    const value = (inputEl?.value || '').trim();

    if (!canvasEl || !window.JsBarcode) return;

    try {
        // CODE128: يقرأ "كود المنتج" فقط (البيانات الأخرى تظهر كنص أعلى الباركود)
        JsBarcode("#barcodeCanvas", value, {
            width: 1.2,
            height: 50,
            displayValue: false,
            margin: 0
        });

    } catch (e) {
        console.error(e);
    }

    const textEl = document.getElementById('barcode-text');
    if (textEl) textEl.textContent = value;
}

function openBarcodeModalWithData(data) {
    if (!data) return;

    const _barcodeModal = document.getElementById("barcode-modal");
    const _barcodeText = document.getElementById("barcode-text");
    const _barcodeProductNameEl = document.getElementById("barcode-product-name");
    const _barcodeProductInfoEl = document.getElementById("barcode-product-info");

    // المطلوب: الباركود يقرأ "كود المنتج" فقط
    // لذلك نستخدم base barcode إن وجد، وإلا نرجع للـ barcode
    const productCode = String(
        data.barcode_only ||
        data.base_barcode ||
        data.baseBarcode ||
        data.product_code ||
        data.productCode ||
        data.barcode ||
        data.id ||
        ''
    ).trim() || formatBarcodeValue(data.id || '');

    const name = data.name || '...';
    const size = data.size || '-';
    const color = data.color || '-';
    const price = (data.price !== undefined && data.price !== null) ? formatPrice(data.price) : '';

    if (_barcodeProductNameEl) _barcodeProductNameEl.textContent = name;
    if (_barcodeProductInfoEl) {
        _barcodeProductInfoEl.innerHTML = `السعر: <b>${escapeHtml(price)}</b> — اللون: <b>${escapeHtml(color)}</b> — المقاس: <b>${escapeHtml(size)}</b>`;
    }

    // جهز input + canvas
    const inputEl = document.getElementById('barcodeInput');
    const printedBox = document.getElementById('barcode-printed-code');
    if (printedBox) printedBox.style.display = 'none';
    if (inputEl) {
        inputEl.value = productCode;
        // لو حابب تمنع التعديل خليها readOnly:
        // inputEl.readOnly = true;
    }

    // اعمل توليد مباشر زي المثال اللي بعته المستخدم
    generateBarcode();

    if (_barcodeText) _barcodeText.textContent = productCode;

    if (_barcodeModal) _barcodeModal.classList.add("active");
}

async function openBarcodeModal(productId) {
    try {
        const product = await getProductById(productId);
        openBarcodeModalWithData(product);
    } catch (e) {
        // fallback
        openBarcodeModalWithData({ id: productId, barcode: formatBarcodeValue(productId), name: `#${productId}`, size: '-', color: '-', price: '' });
    }
}


function markBarcodePrinted(code) {
    const box = document.getElementById('barcode-printed-code');
    const val = document.getElementById('barcode-printed-value');
    if (val) val.textContent = code || '';
    if (box) box.style.display = code ? 'block' : 'none';
}

function closeBarcodeModalOnly() {
    const m = document.getElementById("barcode-modal");
    if (m) m.classList.remove("active");
}
function printBarcode() {
    const code = (document.getElementById("barcodeInput")?.value || "").trim();
    if (!code) {
        alert("اكتب كود المنتج الأول");
        return;
    }

    // تأكد إن الباركود اتولد في المودال
    generateBarcode();

    // اطبع صفحة واحدة 55x30
    printBarcodeOnly(55, 30);
}



function downloadBarcodePng() {
    try {
        const canvasEl = document.getElementById("barcodeCanvas");
        const code = (document.getElementById("barcodeInput")?.value || "barcode").trim() || "barcode";
        if (!canvasEl) return;

        const link = document.createElement("a");
        link.download = `${code}.png`;
        link.href = canvasEl.toDataURL("image/png");
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (e) {
        console.error(e);
    }
}


// ==============================
// نظام الموردين (Suppliers)
// ==============================

const addSupplierBtn = document.getElementById("add-supplier-btn");
const supplierModal = document.getElementById("supplier-modal");
const supplierForm = document.getElementById("supplier-form");
const supplierVariantsWrap = document.getElementById("supplier-variants");
const addVariantBtn = document.getElementById("add-variant-btn");

function resetSupplierVariants() {
    if (!supplierVariantsWrap) return;
    supplierVariantsWrap.innerHTML = "";
    addSupplierVariantRow();
}

function addSupplierVariantRow(preset = {}) {
    if (!supplierVariantsWrap) return;
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.innerHTML = `
        <input type="text" class="variant-size" placeholder="مقاس" value="${escapeHtml(preset.size || '')}" required />
        <input type="text" class="variant-color" placeholder="لون" value="${escapeHtml(preset.color || '')}" required />
        <input type="number" class="variant-qty" placeholder="كمية" min="1" value="${escapeHtml(String(preset.quantity || '1'))}" required />
        <button type="button" class="btn btn-danger btn-sm variant-remove" title="حذف">
            <i class="fas fa-trash"></i>
        </button>
    `;
    row.querySelector('.variant-remove')?.addEventListener('click', () => {
        // لا تترك القائمة فاضية
        if (supplierVariantsWrap.querySelectorAll('.variant-row').length <= 1) {
            row.querySelector('.variant-size').value = '';
            row.querySelector('.variant-color').value = '';
            row.querySelector('.variant-qty').value = '1';
            return;
        }
        row.remove();
    });

    // معاينة/طباعة الباركود لهذا اللون/المقاس مباشرة من شاشة الإضافة
    row.querySelector('.variant-barcode')?.addEventListener('click', () => {
        const base = (document.getElementById("supplier-new-barcode")?.value || "").trim();
        const itemName = (document.getElementById("supplier-item")?.value || "منتج").trim();
        const sellPrice = parseFloat(document.getElementById("supplier-sell")?.value || "0");
        const size = (row.querySelector('.variant-size')?.value || '').trim();
        const color = (row.querySelector('.variant-color')?.value || '').trim();

        if (!base) { alert("اكتب الباركود الأساسي الأول"); return; }
        if (!size || !color) { alert("اكتب المقاس واللون"); return; }

        const barcode = generateVariantBarcode(base, size, color);
        openBarcodeModalWithData({
            name: itemName,
            price: Number.isFinite(sellPrice) ? sellPrice : '',
            size,
            color,
            barcode_only: base,
            barcode: barcode,
        });
    });

    supplierVariantsWrap.appendChild(row);
}

// Fallback (very important): Event Delegation
// If any row is rendered/updated without direct listeners, this guarantees the barcode button works.
document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.variant-barcode');
    if (!btn) return;
    const row = btn.closest('.variant-row');
    if (!row) return;

    // Only when supplier modal is open / variants exist
    if (!document.getElementById('supplier-modal')?.classList.contains('active') && !supplierVariantsWrap) {
        return;
    }

    const base = (document.getElementById("supplier-new-barcode")?.value || "").trim();
    const itemName = (document.getElementById("supplier-item")?.value || "منتج").trim();
    const sellPrice = parseFloat(document.getElementById("supplier-sell")?.value || "0");
    const size = (row.querySelector('.variant-size')?.value || '').trim();
    const color = (row.querySelector('.variant-color')?.value || '').trim();

    if (!base) { alert("اكتب الباركود الأساسي الأول"); return; }
    if (!size || !color) { alert("اكتب المقاس واللون"); return; }

    const barcode = generateVariantBarcode(base, size, color);
    openBarcodeModalWithData({
        name: itemName,
        price: Number.isFinite(sellPrice) ? sellPrice : '',
        size,
        color,
        barcode_only: base,
        barcode: barcode
    });
});

function collectSupplierVariants() {
    if (!supplierVariantsWrap) return [];
    const rows = Array.from(supplierVariantsWrap.querySelectorAll('.variant-row'));
    return rows.map(r => ({
        size: (r.querySelector('.variant-size')?.value || '').trim(),
        color: (r.querySelector('.variant-color')?.value || '').trim(),
        quantity: parseInt((r.querySelector('.variant-qty')?.value || '0'), 10),
    })).filter(v => v.size && v.color && Number.isFinite(v.quantity) && v.quantity > 0);
}

function initSuppliersSystem() {
    if (addSupplierBtn) {
        addSupplierBtn.addEventListener("click", () => {
            // reset fields
            if (supplierForm) supplierForm.reset();
            resetSupplierVariants();
            if (supplierModal) supplierModal.classList.add("active");
        });
    }

    // add variant row
    if (addVariantBtn) {
        addVariantBtn.addEventListener('click', () => addSupplierVariantRow());
    }

    if (supplierForm) {
        supplierForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            // Read invoice image (optional) as Base64 data URL
            const fileInput = document.getElementById("supplier-invoice-image");
            const file = fileInput?.files?.[0];
            let invoiceImageDataUrl = null;
            if (file) {
                invoiceImageDataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result || null);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(file);
                });
            }

            const variants = collectSupplierVariants();

            const supplierData = {
                name: document.getElementById("supplier-name")?.value?.trim(),
                phone: document.getElementById("supplier-phone")?.value?.trim(),
                item: document.getElementById("supplier-item")?.value?.trim(),
                category: document.getElementById("supplier-category")?.value?.trim() || 'women',
                wholesale_price: parseFloat(document.getElementById("supplier-wholesale")?.value || "0"),
                sell_price: parseFloat(document.getElementById("supplier-sell")?.value || "0"),
                supplier_barcode: document.getElementById("supplier-barcode")?.value?.trim(),
                base_barcode: document.getElementById("supplier-new-barcode")?.value?.trim(),
                variants,
                invoice_number: document.getElementById("supplier-invoice")?.value?.trim(),
                date: document.getElementById("supplier-date")?.value?.trim(),
                notes: document.getElementById("supplier-notes")?.value?.trim(),
                invoice_image: invoiceImageDataUrl,
            };

            // Basic validation
            if (!supplierData.name || !supplierData.item) {
                alert("من فضلك اكتب اسم المورد واسم السلعة");
                return;
            }
            if (!supplierData.base_barcode) {
                alert("من فضلك اكتب الباركود الجديد (الأساسي)");
                return;
            }
            if (!Number.isFinite(supplierData.wholesale_price) || supplierData.wholesale_price < 0) {
                alert("من فضلك اكتب سعر جملة صحيح");
                return;
            }
            if (!Number.isFinite(supplierData.sell_price) || supplierData.sell_price <= 0) {
                alert("من فضلك اكتب سعر بيع صحيح");
                return;
            }
            if (!Array.isArray(variants) || variants.length === 0) {
                alert("من فضلك أضف مقاس/لون/كمية واحدة على الأقل");
                return;
            }

            const ok = await saveSupplier(supplierData);
            if (ok && supplierModal) supplierModal.classList.remove("active");
        });
    }
}

// فتح نافذة عرض بيانات المورد (Popup)
function openSupplierViewModal(supplier) {
    const modal = document.getElementById("supplier-view-modal");
    const content = document.getElementById("supplier-view-content");
    if (!modal || !content) return;

    const invoiceNo = (supplier.invoice_number && String(supplier.invoice_number).trim()) ? supplier.invoice_number : `#${supplier.id}`;
    let variants = supplier.variants;
    if (!variants && supplier.variants_json) variants = supplier.variants_json;
    if (typeof variants === 'string') {
        try { variants = JSON.parse(variants); } catch (_) { variants = []; }
    }
    if (!Array.isArray(variants)) variants = [];

    const base = (supplier.base_barcode || supplier.new_barcode || supplier.generated_barcode || '').trim();
    const makeBarcode = (b, s, c) => {
        const clean = (x) => String(x || '').trim().replace(/\s+/g, '').replace(/[^\w-]/g, '');
        return `${clean(b)}-${clean(s)}-${clean(c)}`;
    };

    const variantsHtml = variants.length ? `
        <div style="margin-top:16px;">
            <div style="font-weight:800; color:var(--dark); margin-bottom:8px;">الألوان والمقاسات</div>
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${variants.map(v => {
        const vb = makeBarcode(base, v.size, v.color);
        return `
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px; border:1px solid rgba(0,0,0,0.08); border-radius:12px;">
                            <div style="line-height:1.8;">
                                <div style="font-weight:800; color:var(--dark);">${escapeHtml(v.color)} - ${escapeHtml(v.size)}</div>
                                <div style="color:var(--gray); font-size:12px;">الكمية: <b>${escapeHtml(String(v.quantity || 0))}</b> — باركود: <span style="direction:ltr; font-weight:700;">${escapeHtml(vb)}</span></div>
                            </div>
                        </div>
                    `;
    }).join('')}
            </div>
        </div>
    ` : `
        <div style="margin-top:16px; color:var(--gray);">لا توجد مقاسات/ألوان مسجلة.</div>
    `;

    content.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <div><div style="color:var(--gray); font-size:12px;">اسم المورد</div><div style="font-weight:800; color:var(--dark);">${escapeHtml(supplier.name || '-')}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">رقم الهاتف</div><div style="font-weight:700; color:var(--dark);">${escapeHtml(supplier.phone || '-')}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">اسم السلعة</div><div style="font-weight:700; color:var(--dark);">${escapeHtml(supplier.item || '-')}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">الفئة</div><div style="font-weight:700; color:var(--dark);">${escapeHtml(supplier.category || '-')}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">سعر الجملة</div><div style="font-weight:700; color:var(--dark);">${escapeHtml(String(supplier.wholesale_price ?? '-'))}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">سعر البيع</div><div style="font-weight:700; color:var(--dark);">${escapeHtml(String(supplier.sell_price ?? '-'))}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">باركود المورد</div><div style="font-weight:700; color:var(--dark); direction:ltr;">${escapeHtml(supplier.supplier_barcode || '-')}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">الباركود الأساسي</div><div style="font-weight:700; color:var(--dark); direction:ltr;">${escapeHtml(base || '-')}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">رقم الفاتورة</div><div style="font-weight:700; color:var(--dark);">${escapeHtml(invoiceNo)}</div></div>
            <div><div style="color:var(--gray); font-size:12px;">تاريخ الشراء</div><div style="font-weight:700; color:var(--dark);">${escapeHtml(supplier.date || '-')}</div></div>
        </div>

        <div style="margin-top:14px;">
            <div style="color:var(--gray); font-size:12px;">ملاحظات</div>
            <div style="margin-top:6px; font-weight:600; color:var(--dark); white-space:pre-wrap;">${escapeHtml(supplier.notes || '-')}</div>
        </div>
        ${variantsHtml}
    `;

    if (supplier.invoice_image) {
        const imgWrap = document.createElement('div');
        imgWrap.style.marginTop = '16px';
        imgWrap.innerHTML = `
            <div style="color:var(--gray); font-size:12px; margin-bottom:8px;">صورة الفاتورة</div>
            <img src="${supplier.invoice_image}" alt="invoice" class="supplier-invoice-thumb" style="width:100%; max-height:260px; object-fit:contain; border-radius:12px; cursor:zoom-in; border:1px solid rgba(0,0,0,0.08);" />
        `;
        const img = imgWrap.querySelector('img');
        img?.addEventListener('click', () => openImagePreview(supplier.invoice_image));
        content.appendChild(imgWrap);
    }

    modal.classList.add('active');
}

// معاينة الصورة (تكبير)
function openImagePreview(src) {
    if (!src) return;
    let overlay = document.getElementById('image-preview-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'image-preview-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.75)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'none';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.padding = '24px';
        overlay.innerHTML = `
            <div style="position:relative; max-width: 100%; max-height: 200%;">
                <button id="image-preview-close" class="btn btn-outline" style="position:absolute; top:-50px; left:0;">إغلاق</button>
                <img id="image-preview-img" src="" alt="preview" style="max-width: 90vw; max-height: 85vh; border-radius:16px; object-fit:contain;" />
            </div>
        `;
        document.body.appendChild(overlay);

        const close = () => {
            overlay.style.display = 'none';
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelector('#image-preview-close')?.addEventListener('click', close);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        });
    }

    overlay.querySelector('#image-preview-img').src = src;
    overlay.style.display = 'flex';
}

// تحميل جدول الموردين
async function loadSuppliersTable() {
    try {
        const response = await fetch(`${API_URL}/suppliers`);
        const suppliers = await response.json();

        const listEl = document.getElementById("suppliers-list");
        const tableBody = document.getElementById("suppliers-table");

        // Prefer the new list UI
        if (listEl) {
            listEl.innerHTML = "";

            if (!Array.isArray(suppliers) || suppliers.length === 0) {
                listEl.innerHTML = `
                    <div style="text-align:center; padding:40px; color:var(--gray);">
                        <i class="fas fa-truck" style="font-size:32px; margin-bottom:16px;"></i>
                        <p>لا توجد فواتير موردين حتى الآن.</p>
                    </div>
                `;
                return;
            }

            suppliers.forEach(s => {
                const invoiceNo = (s.invoice_number && String(s.invoice_number).trim()) ? s.invoice_number : `#${s.id}`;
                const date = s.date || '';
                const card = document.createElement("div");
                card.className = "supplier-invoice-card";
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                        <div style="font-weight:800; color:var(--dark);">
                            <i class="fas fa-file-invoice"></i> فاتورة رقم ${escapeHtml(invoiceNo)}
                        </div>
                        <div style="color:var(--gray); font-size: 13px;">${escapeHtml(date)}</div>
                    </div>
                    <div style="margin-top:10px; color:var(--gray);">
                        <span style="font-weight:700; color:var(--dark);">${escapeHtml(s.name || 'مورد')}</span>
                        ${s.item ? `— ${escapeHtml(s.item)}` : ''}
                    </div>
                    <div style="margin-top:12px; display:flex; gap:10px; align-items:center;">
                        <button class="btn btn-outline btn-sm view-supplier-btn">
                            <i class="fas fa-eye"></i> عرض البيانات
                        </button>
                        <button class="btn btn-danger btn-sm delete-supplier-btn" style="margin-right:auto;">
                            <i class="fas fa-trash"></i> حذف
                        </button>
                    </div>
                `;

                card.querySelector(".view-supplier-btn").addEventListener("click", () => {
                    openSupplierViewModal(s);
                });

                card.querySelector(".delete-supplier-btn").addEventListener("click", async () => {
                    if (!confirm("هل تريد حذف هذه الفاتورة؟")) return;
                    await deleteSupplier(s.id);
                });

                listEl.appendChild(card);
            });

            return;
        }

        // Fallback: old table if list UI not present
        if (!tableBody) return;

        tableBody.innerHTML = "";

        if (!Array.isArray(suppliers) || suppliers.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; padding: 40px; color: var(--gray);">
                        <i class="fas fa-truck" style="font-size: 32px; margin-bottom: 16px;"></i>
                        <p>لا توجد بيانات للموردين حتى الآن.</p>
                    </td>
                </tr>
            `;
            return;
        }

        suppliers.forEach(supplier => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${supplier.name || ''}</td>
                <td>${supplier.phone || ''}</td>
                <td>${supplier.item || ''}</td>
                <td>${supplier.size || ''}</td>
                <td>${supplier.quantity || ''}</td>
                <td>${supplier.price || ''}</td>
                <td>${supplier.invoice_number || ''}</td>
                <td>${supplier.date || ''}</td>
                <td>${supplier.notes || ''}</td>
                <td>
                    <button class="btn btn-danger btn-sm" onclick="deleteSupplier(${supplier.id})">
                        <i class="fas fa-trash"></i> حذف
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading suppliers:', error);
        const listEl = document.getElementById("suppliers-list");
        if (listEl) {
            listEl.innerHTML = `
                <div style="text-align:center; padding:40px; color:var(--danger);">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>حدث خطأ في تحميل بيانات الموردين</p>
                </div>
            `;
            return;
        }
        const tableBody = document.getElementById("suppliers-table");
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="11" style="text-align: center; padding: 40px; color: var(--danger);">
                        <i class="fas fa-exclamation-triangle"></i>
                        <p>حدث خطأ في تحميل بيانات الموردين</p>
                    </td>
                </tr>
            `;
        }
    }
}
// حفظ مورد جديد
async function saveSupplier(supplierData) {
    try {
        const response = await fetch(`${API_URL}/suppliers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(supplierData)
        });

        if (response.ok) {
            await loadSuppliersTable();
            await addLog("المسؤول", "إضافة مورد", `تم إضافة مورد جديد: ${supplierData.name}`);
            return true;
        } else {
            throw new Error('فشل حفظ المورد');
        }
    } catch (error) {
        console.error('Error saving supplier:', error);
        alert('حدث خطأ في حفظ بيانات المورد');
        return false;
    }
}

// حذف مورد
async function deleteSupplier(supplierId) {
    if (!confirm("هل أنت متأكد أنك تريد حذف هذا المورد؟")) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/suppliers/${supplierId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadSuppliersTable();
            await addLog("المسؤول", "حذف مورد", `تم حذف المورد رقم ${supplierId}`);
            alert('تم حذف المورد بنجاح');
        } else {
            throw new Error('فشل حذف المورد');
        }
    } catch (error) {
        console.error('Error deleting supplier:', error);
        alert('حدث خطأ في حذف المورد');
    }
}

// ==============================
// نظام المرتجعات (Returns)
// ==============================

const processReturnBtn = document.getElementById("process-return-btn");
const syncReturnsBtn = document.getElementById("sync-returns-btn");
const returnModal = document.getElementById("return-modal");
const returnForm = document.getElementById("return-form");
const returnProductsList = document.getElementById("return-products-list");
const returnDetailsModal = document.getElementById("return-details-modal");
const deleteReturnBtn = document.getElementById("delete-return-btn");
const completeReturnBtn = document.getElementById("complete-return-btn");

let CURRENT_INVOICE_FOR_RETURN = null;

async function initReturnsSystem() {
    await loadInvoicesForReturns();
    await loadReturnsHistory();
    await updateReturnsDashboard();

    if (syncReturnsBtn) {
        syncReturnsBtn.addEventListener("click", async () => {
            await loadInvoicesForReturns();
            await loadReturnsHistory();
            await updateReturnsDashboard();
        });
    }

    if (processReturnBtn) {
        processReturnBtn.addEventListener("click", () => {
            // إرشاد سريع
            alert("اختر فاتورة من الجدول ثم اضغط (معالجة) لبدء الإرجاع.");
        });
    }

    if (returnForm) {
        returnForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            await saveReturnFromModal();
        });
    }

    if (completeReturnBtn) {
        completeReturnBtn.addEventListener("click", async () => {
            document.getElementById("return-status").value = "completed";
            await saveReturnFromModal(true);
        });
    }

    if (deleteReturnBtn) {
        deleteReturnBtn.addEventListener("click", async () => {
            const returnId = document.getElementById("return-id").value;
            if (!returnId) {
                closeAllModals();
                return;
            }
            if (!confirm("هل تريد حذف المرتجع؟")) return;
            await fetch(`${API_URL}/returns/${returnId}`, { method: "DELETE" });
            await loadReturnsHistory();
            await updateReturnsDashboard();
            closeAllModals();
        });
    }
}

async function loadInvoicesForReturns() {
    const tableBody = document.getElementById("returns-invoices-table");
    if (!tableBody) return;
    try {
        const res = await fetch(`${API_URL}/sales/invoices`);
        const invoices = await res.json();

        if (!Array.isArray(invoices) || invoices.length === 0) {
            tableBody.innerHTML = `
                <tr><td colspan="7" style="text-align:center;padding:40px;color:var(--gray);">لا توجد فواتير.</td></tr>
            `;
            return;
        }

        tableBody.innerHTML = "";
        invoices.forEach(inv => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${inv.id}</td>
                <td>${inv.customer || "عميل متجر"}</td>
                <td>${formatDateTime(inv.created_at)}</td>
                <td>${formatPrice(inv.total)}</td>
                <td>${inv.items_count || 0}</td>
                <td><span class="status-badge status-in-stock">متاحة</span></td>
                <td>
                    <button class="btn btn-outline" onclick="openReturnForInvoice(${inv.id})">
                        <i class="fas fa-undo"></i> معالجة
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (e) {
        console.error(e);
        tableBody.innerHTML = `
            <tr><td colspan="7" style="text-align:center;padding:40px;color:var(--danger);">خطأ في تحميل الفواتير.</td></tr>
        `;
    }
}

// فتح مودال الإرجاع لفاتورة
window.openReturnForInvoice = async function (invoiceId) {
    try {
        const res = await fetch(`${API_URL}/sales/invoices/${invoiceId}`);
        const invoice = await res.json();
        if (!invoice || invoice.error) {
            alert("الفاتورة غير موجودة");
            return;
        }
        CURRENT_INVOICE_FOR_RETURN = invoice;

        // تعبئة الحقول
        document.getElementById("return-sale-id").value = invoice.id;
        document.getElementById("return-id").value = "";
        document.getElementById("return-invoice").value = invoice.id;
        document.getElementById("return-customer").value = invoice.customer || "عميل متجر";
        document.getElementById("return-date").value = formatDateTime(invoice.created_at);
        document.getElementById("return-original-total").value = formatPrice(invoice.total);
        document.getElementById("return-amount").value = Number(invoice.total || 0).toFixed(2);

        // قائمة المنتجات
        returnProductsList.innerHTML = "";
        (invoice.items || []).forEach((it, idx) => {
            const wrap = document.createElement("div");
            wrap.style.display = "flex";
            wrap.style.alignItems = "center";
            wrap.style.gap = "10px";
            wrap.style.padding = "8px";
            wrap.style.border = "1px solid #e2e8f0";
            wrap.style.borderRadius = "10px";
            wrap.style.marginBottom = "8px";
            wrap.innerHTML = `
                <input type="checkbox" class="return-item-check" data-index="${idx}">
                <div style="flex:1">
                    <div style="font-weight:600">${it.product_name}</div>
                    <div style="font-size:12px;color:var(--gray)">الكمية في الفاتورة: ${it.quantity} | السعر: ${formatPrice(it.price)}</div>
                </div>
                <input type="number" class="return-item-qty" data-index="${idx}" min="1" max="${it.quantity}" value="1" style="width:90px">
            `;
            returnProductsList.appendChild(wrap);
        });

        // إظهار المودال
        if (returnModal) returnModal.classList.add("active");
    } catch (e) {
        console.error(e);
        alert("حدث خطأ في فتح الفاتورة");
    }
}

async function saveReturnFromModal(forceCompleted = false) {
    if (!CURRENT_INVOICE_FOR_RETURN) {
        alert("اختر فاتورة أولاً");
        return;
    }

    const reason = document.getElementById("return-reason").value;
    const desc = document.getElementById("return-description").value || "";
    const status = document.getElementById("return-status").value;
    const refundAmount = Math.max(0, Number(document.getElementById("return-amount").value) || 0);
    const returnMethod = document.getElementById("return-method").value;
    const refundMethod = document.getElementById("return-refund-method").value;
    const notes = document.getElementById("return-notes").value || "";

    const selected = Array.from(document.querySelectorAll(".return-item-check"))
        .filter(c => c.checked)
        .map(c => Number(c.getAttribute("data-index")));

    if (selected.length === 0) {
        alert("اختار منتج واحد على الأقل للإرجاع");
        return;
    }

    const perItemRefund = refundAmount / selected.length;
    const finalStatus = forceCompleted ? "completed" : status;

    for (const idx of selected) {
        const item = CURRENT_INVOICE_FOR_RETURN.items[idx];
        const qtyEl = document.querySelector(`.return-item-qty[data-index='${idx}']`);
        const qty = Math.min(item.quantity, Math.max(1, Number(qtyEl?.value) || 1));

        const payload = {
            invoice_id: CURRENT_INVOICE_FOR_RETURN.id,
            product_id: item.product_id,
            quantity: qty,
            reason: `${reason}${desc ? " - " + desc : ""} | method:${returnMethod} | refund:${refundMethod} | notes:${notes}`,
            refund_amount: perItemRefund,
            status: finalStatus
        };

        await fetch(`${API_URL}/returns`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    }

    await addLog(CURRENT_SESSION?.name || "المستخدم", "مرتجع", `تم إنشاء مرتجع لفاتورة ${CURRENT_INVOICE_FOR_RETURN.id}`);
    await loadReturnsHistory();
    await updateReturnsDashboard();
    closeAllModals();
    alert("تم حفظ المرتجع");
}

async function loadReturnsHistory() {
    const tableBody = document.getElementById("returns-history-table");
    if (!tableBody) return;
    try {
        const res = await fetch(`${API_URL}/returns`);
        const returns = await res.json();

        if (!Array.isArray(returns) || returns.length === 0) {
            tableBody.innerHTML = `
                <tr><td colspan="8" style="text-align:center;padding:40px;color:var(--gray);">لا توجد مرتجعات.</td></tr>
            `;
            return;
        }

        tableBody.innerHTML = "";
        returns.forEach(r => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${r.id}</td>
                <td>${r.invoice_id}</td>
                <td>${r.customer || "-"}</td>
                <td>${formatDateTime(r.created_at)}</td>
                <td>${formatPrice(r.refund_amount || 0)}</td>
                <td>${(r.reason || "").includes("method:exchange") ? "استبدال" : "استرداد"}</td>
                <td>${r.status || "pending"}</td>
                <td>
                    <button class="btn btn-outline" onclick="showReturnDetails(${r.id})"><i class="fas fa-eye"></i> عرض</button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (e) {
        console.error(e);
        tableBody.innerHTML = `
            <tr><td colspan="8" style="text-align:center;padding:40px;color:var(--danger);">خطأ في تحميل المرتجعات.</td></tr>
        `;
    }
}

window.showReturnDetails = async function (returnId) {
    try {
        const res = await fetch(`${API_URL}/returns`);
        const list = await res.json();
        const r = (list || []).find(x => x.id === returnId);
        if (!r) return;

        const content = document.getElementById("return-details-content");
        if (content) {
            content.innerHTML = `
                <div style="line-height:1.8">
                    <p><b>رقم المرتجع:</b> ${r.id}</p>
                    <p><b>رقم الفاتورة:</b> ${r.invoice_id}</p>
                    <p><b>المنتج:</b> ${r.product_name || "-"}</p>
                    <p><b>الكمية:</b> ${r.quantity}</p>
                    <p><b>المبلغ:</b> ${formatPrice(r.refund_amount || 0)}</p>
                    <p><b>الحالة:</b> ${r.status}</p>
                    <p><b>السبب:</b> ${r.reason || "-"}</p>
                </div>
            `;
        }

        if (returnDetailsModal) returnDetailsModal.classList.add("active");
    } catch (e) {
        console.error(e);
    }
}

async function updateReturnsDashboard() {
    try {
        const res = await fetch(`${API_URL}/dashboard/stats`);
        const stats = await res.json();
        if (!stats) return;
        const todayReturnsEl = document.getElementById("today-returns");
        const totalValueEl = document.getElementById("total-returns-value");
        const pendingEl = document.getElementById("pending-returns");
        const completedEl = document.getElementById("completed-returns");
        if (todayReturnsEl) todayReturnsEl.textContent = stats.today_returns || 0;
        if (totalValueEl) totalValueEl.textContent = formatPrice(stats.total_returns_value || 0);
        if (pendingEl) pendingEl.textContent = stats.pending_returns || 0;
        if (completedEl) completedEl.textContent = stats.completed_returns || 0;
    } catch (e) {
        console.error(e);
    }
}

// ==============================
// تهيئة النظام عند تحميل الصفحة
// ==============================

// التأكد من تحميل النظام عند بدء التطبيق
document.addEventListener("DOMContentLoaded", function () {
    // التحقق من الجلسة أولاً
    const session = checkSession();
    if (!session) return;

    // تهيئة التطبيق
    init();
});


// ==============================
// QR Generator (BARCODE LABEL) - FIXED PRINT 55x30mm
// ==============================
let __qrInstance = null;

function initQrGenerator() {
    const codeEl = document.getElementById("qrProductCode");
    const nameEl = document.getElementById("qrProductName");
    const priceEl = document.getElementById("qrPrice");
    const colorEl = document.getElementById("qrColor");
    const sizeEl = document.getElementById("qrSize");
    const qrBox = document.getElementById("qrBox");
    const btnPrint = document.getElementById("btnPrintQr");
    const btnClear = document.getElementById("btnClearQr");
    const statusEl = document.getElementById("qrPrintStatus");

    if (!codeEl || !qrBox || !btnPrint || !btnClear) return;

    function updateLabelTexts() {
        const code = (codeEl.value || "").trim();
        const name = (nameEl?.value || "").trim();
        const price = (priceEl?.value || "").trim();
        const color = (colorEl?.value || "").trim();
        const size = (sizeEl?.value || "").trim();

        document.getElementById("qrTopCode1").textContent = code ? code.slice(0, Math.min(8, code.length)) : "—";
        document.getElementById("qrTopCode2").textContent = price || "—";
        document.getElementById("qrTopName").textContent = name || "—";

        document.getElementById("qrBottomCode").textContent = code || "—";
        document.getElementById("qrBottomColor").textContent = color || "—";
        document.getElementById("qrBottomSize").textContent = size || "—";
    }

    function generateQr() {
        const code = (codeEl.value || "").trim();
        updateLabelTexts();

        qrBox.innerHTML = "";
        if (!code) {
            qrBox.innerHTML = `<div class="qr-empty">اكتب كود المنتج لعرض الباركود</div>`;
            __qrInstance = null;
            return;
        }

        // Canvas باركود حقيقي قابل للقراءة
        const canvas = document.createElement("canvas");
        canvas.id = "barcodeCanvas";
        qrBox.appendChild(canvas);

        try {
            JsBarcode(canvas, code, {
                format: "CODE128",
                lineColor: "#000",
                width: 1.4,      // مناسب لليبل 55mm
                height: 40,      // مناسب لارتفاع 30mm
                displayValue: false,
                margin: 0
            });
        } catch (err) {
            console.error(err);
            qrBox.innerHTML = `<div class="qr-empty">الكود غير صالح لتوليد باركود</div>`;
        }

        __qrInstance = canvas;
    }

    // live update
    const liveInputs = [codeEl, nameEl, priceEl, colorEl, sizeEl].filter(Boolean);
    liveInputs.forEach(el => el.addEventListener("input", generateQr));

    btnClear.addEventListener("click", () => {
        codeEl.value = "";
        if (nameEl) nameEl.value = "";
        if (priceEl) priceEl.value = "";
        if (colorEl) colorEl.value = "";
        if (sizeEl) sizeEl.value = "";
        statusEl.style.display = "none";
        statusEl.textContent = "";
        generateQr();
    });

    // ✅ طباعة صح 55x30mm (باركود فقط)
    btnPrint.addEventListener("click", () => {
        const code = (codeEl.value || "").trim();
        if (!code) {
            alert("اكتب كود المنتج الأول");
            return;
        }

        generateQr(); // تأكد ان الباركود اتولد

        // اطبع باركود واحد = صفحة واحدة
        printBarcodeOnly(55, 30);

        if (statusEl) {
            statusEl.style.display = "block";
            statusEl.textContent = `تم طباعة الباركود للكود: ${code}`;
        }
    });

    // initial
    generateQr();
}

document.addEventListener("DOMContentLoaded", () => {
    initQrGenerator();
});


function printBarcodeOnly(labelWmm = 55, labelHmm = 30) {
    const canvas = document.getElementById("barcodeCanvas");
    if (!canvas) return alert("barcodeCanvas مش موجود");

    const imgData = canvas.toDataURL("image/png");

    // Build N copies of the barcode label
    const qty = parseInt((document.getElementById("qrPrintQty") || {}).value || "1") || 1;
    const safeQty = Math.min(Math.max(qty, 1), 200);

    // Build label HTML info from inputs
    const name = (document.getElementById("qrProductName") || {}).value || "";
    const size = (document.getElementById("qrSize") || {}).value || "";
    const color = (document.getElementById("qrColor") || {}).value || "";
    const code = (document.getElementById("qrProductCode") || {}).value || "";
    const price = (document.getElementById("qrPrice") || {}).value || "";

    let labelsHtml = "";
    for (let i = 0; i < safeQty; i++) {
        labelsHtml += `
        <div class="label-page">
            <div class="label-name">${name}</div>
            <img src="${imgData}" alt="barcode"/>
            <div class="label-info">${size ? 'M:' + size : ''} ${color ? 'L:' + color : ''} ${price ? price + ' EGP' : ''}</div>
            <div class="label-code">${code}</div>
        </div>`;
    }

    const w = window.open("", "_blank", "width=500,height=400");
    w.document.open();
    w.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Barcode Print x${safeQty}</title>
        <style>
          @page { 
            size: ${labelWmm}mm ${labelHmm}mm; 
            margin: 0; 
          }
          html, body {
            margin: 0; 
            padding: 0;
            background: #fff;
            font-family: Arial, sans-serif;
          }
          .label-page {
            width: ${labelWmm}mm;
            height: ${labelHmm}mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 1mm;
            box-sizing: border-box;
            page-break-after: always;
            overflow: hidden;
          }
          .label-name {
            font-size: 7px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1mm;
            white-space: nowrap;
            overflow: hidden;
          }
          .label-info {
            font-size: 6px;
            color: #555;
            text-align: center;
            white-space: nowrap;
          }
          .label-code {
            font-size: 7px;
            font-weight: 900;
            letter-spacing: 0.5px;
            text-align: center;
          }
          img {
            max-width: ${labelWmm - 4}mm;
            max-height: ${Math.round(labelHmm * 0.55)}mm;
            width: auto;
            height: auto;
            display: block;
            object-fit: contain;
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
        <script>
          window.onload = function() { 
            setTimeout(function() { 
              window.print(); 
              setTimeout(function() { window.close(); }, 200);
            }, 150);
          };
        <\/script>
      </body>
    </html>
  `);
    w.document.close();
}

// ================================
// EMPLOYEE MANAGEMENT
// ================================
async function loadEmployeesTable() {
    try {
        const res = await fetch(`${API_URL}/users`);
        const users = await res.json();
        const tbody = document.getElementById("employees-table");
        if (!tbody) return;
        tbody.innerHTML = "";
        if (!users.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--gray);">لا يوجد موظفون مسجلون.</td></tr>`;
            return;
        }
        users.forEach(u => {
            const roleBadge = u.role === 'admin'
                ? `<span class="status status-in-stock">مسؤول</span>`
                : `<span class="status status-low-stock">كاشير</span>`;
            const canDelete = CURRENT_SESSION && u.username !== CURRENT_SESSION.username;
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${u.id}</td>
                <td style="font-weight:600; color:var(--dark);">${u.name || "—"}</td>
                <td style="direction:ltr; text-align:right;">${u.username}</td>
                <td>${roleBadge}</td>
                <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('ar-EG') : '—'}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="openSalaryModal(${u.id}, '${u.name || u.username}')">
                        <i class="fas fa-money-bill-wave"></i> الرواتب
                    </button>
                </td>
                <td>
                    <div class="action-buttons">
                        <div class="action-btn" title="تعديل" onclick="openEmployeeModal(${u.id})"><i class="fas fa-edit"></i></div>
                        ${canDelete ? `<div class="action-btn" title="حذف" onclick="deleteEmployee(${u.id}, '${u.name || u.username}')"><i class="fas fa-trash"></i></div>` : ''}
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        console.error("Error loading employees:", e);
    }
}

async function openEmployeeModal(id = null) {
    const modal = document.getElementById("employee-modal");
    const title = document.getElementById("employee-modal-title");
    const form = document.getElementById("employee-form");
    if (!modal || !form) return;

    form.reset();
    document.getElementById("employee-id").value = "";

    if (id) {
        title.textContent = "تعديل بيانات الموظف";
        document.getElementById("employee-id").value = id;
        try {
            const res = await fetch(`${API_URL}/users`);
            const users = await res.json();
            const u = users.find(x => x.id == id);
            if (u) {
                document.getElementById("employee-name").value = u.name || "";
                document.getElementById("employee-username").value = u.username;
                document.getElementById("employee-role").value = u.role || "cashier";
            }
        } catch (e) { }
    } else {
        title.textContent = "إضافة موظف جديد";
    }
    modal.classList.add("active");
}

async function saveEmployee() {
    const id = document.getElementById("employee-id").value;
    const name = document.getElementById("employee-name").value.trim();
    const username = document.getElementById("employee-username").value.trim();
    const password = document.getElementById("employee-password").value;
    const role = document.getElementById("employee-role").value;

    if (!username) { alert("اسم المستخدم مطلوب"); return; }
    if (!id && !password) { alert("كلمة المرور مطلوبة للموظفين الجدد"); return; }

    try {
        const body = { name, username, role };
        if (password) body.password = password;

        const url = id ? `${API_URL}/users/${id}` : `${API_URL}/users`;
        const method = id ? "PUT" : "POST";

        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "خطأ");
        }
        closeAllModals();
        await loadEmployeesTable();
        alert(id ? "تم تحديث بيانات الموظف" : "تم إضافة الموظف بنجاح");
    } catch (e) {
        alert("خطأ: " + e.message);
    }
}

async function deleteEmployee(id, name) {
    if (!confirm(`هل تريد حذف الموظف "${name}"؟`)) return;
    try {
        const res = await fetch(`${API_URL}/users/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        await loadEmployeesTable();
    } catch (e) {
        alert("حدث خطأ أثناء الحذف");
    }
}

// ================================
// BARCODE – Load products into selector
// ================================
async function loadProductsForBarcodeSelector() {
    const select = document.getElementById("qrProductSelect");
    if (!select) return;
    try {
        const res = await fetch(`${API_URL}/products`);
        const products = await res.json();
        select.innerHTML = `<option value="">-- اختر منتج من المخزون --</option>`;
        products.forEach(p => {
            const opt = document.createElement("option");
            opt.value = JSON.stringify({ id: p.id, name: p.name, barcode: p.barcode, price: p.price, color: p.color, size: p.size });
            opt.textContent = `${p.name} | ${p.size || ""} | ${p.color || ""} | ${p.barcode || p.id}`;
            select.appendChild(opt);
        });
    } catch (e) { }
}

// ================================
// REPRINT INVOICE FROM DASHBOARD
// ================================
async function reprintInvoice(invoiceId) {
    try {
        const res = await fetch(`${API_URL}/sales/invoices/${invoiceId}`);
        if (!res.ok) throw new Error("Invoice not found");
        const inv = await res.json();

        const items = (inv.items || []).map(it => `
            <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px dashed #eee; font-size:13px;">
                <span>${it.product_name} × ${it.quantity}</span>
                <span>${(it.price * it.quantity).toFixed(2)} ج.م</span>
            </div>`).join("");

        const dateStr = inv.created_at ? new Date(inv.created_at).toLocaleString('ar-EG') : "—";

        const html = `
            <div style="text-align:center; margin-bottom:12px;">
                <div style="font-size:18px; font-weight:700; margin-bottom:4px;">فاتورة رقم #${inv.id}</div>
                <div style="color:#888; font-size:13px;">${dateStr}</div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:13px; margin-bottom:12px;">
                <span style="color:#888;">العميل:</span><span>${inv.customer || '—'}</span>
                <span style="color:#888;">الكاشير:</span><span>${inv.cashier_name || '—'}</span>
                <span style="color:#888;">طريقة الدفع:</span><span>${inv.payment_method || '—'}</span>
            </div>
            <div style="margin-bottom:12px;">${items}</div>
            <div style="background:#f8f9fa; border-radius:8px; padding:10px; font-size:14px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span style="color:#888;">الإجمالي:</span><span>${Number(inv.total || 0).toFixed(2)} ج.م</span></div>
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span style="color:#888;">الخصم:</span><span>${Number(inv.discount || 0).toFixed(2)} ج.م</span></div>
                <div style="display:flex; justify-content:space-between; font-weight:700; font-size:16px; border-top:1px solid #ddd; padding-top:8px;"><span>الصافي:</span><span>${(Number(inv.total || 0) - Number(inv.discount || 0)).toFixed(2)} ج.م</span></div>
            </div>
            <div style="text-align:center; margin-top:12px; color:#aaa; font-size:12px;">✨ شكراً لتسوقك معنا ✨</div>
        `;

        const content = document.getElementById("reprint-receipt-content");
        if (content) content.innerHTML = html;

        const modal = document.getElementById("reprint-modal");
        if (modal) modal.classList.add("active");
    } catch (e) {
        alert("لم يتم العثور على الفاتورة");
    }
}

// ================================
// SALARY MANAGEMENT
// ================================
// Online Orders items list
let ooItems = [];

let currentSalaryUserId = null;

function openAddSalaryForm(salaryId = null) {
    const form = document.getElementById("salary-form");
    if (!form) return;
    form.reset();
    document.getElementById("salary-id").value = salaryId || "";
    document.getElementById("salary-emp-id").value = currentSalaryUserId;

    if (!salaryId) {
        // Default month to current
        const now = new Date();
        const m = now.getMonth() + 1;
        document.getElementById("salary-month").value = `${now.getFullYear()}-${m < 10 ? '0' + m : m}`;
        document.getElementById("salary-status").value = "pending";
    }
    form.style.display = "block";
}

async function openSalaryModal(userId, userName) {
    currentSalaryUserId = userId;
    const modal = document.getElementById("salary-modal");
    if (!modal) return;
    document.getElementById("salary-employee-name").textContent = `رواتب الموظف: ${userName}`;
    document.getElementById("salary-form").style.display = "none";
    await loadSalariesTable();
    modal.classList.add("active");
}

async function loadSalariesTable() {
    if (!currentSalaryUserId) return;
    try {
        const res = await fetch(`${API_URL}/salaries?user_id=${currentSalaryUserId}`);
        const salaries = await res.json();
        const tbody = document.getElementById("salaries-table");
        if (!tbody) return;
        tbody.innerHTML = "";

        if (!salaries.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px;">لا يوجد سجل للرواتب</td></tr>`;
            return;
        }

        salaries.forEach(s => {
            const isPaid = s.status === 'paid';
            const statusBadge = isPaid
                ? '<span class="status status-completed">مدفوع</span>'
                : '<span class="status status-pending">معلق</span>';
            const paidDate = s.paid_at ? new Date(s.paid_at).toLocaleDateString('ar-EG') : '—';

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${s.month}</td>
                <td style="font-weight:700;">${Number(s.amount).toFixed(2)} ج.م</td>
                <td>${statusBadge}</td>
                <td style="color:var(--gray); font-size:13px;">${paidDate}</td>
                <td>${s.notes || '—'}</td>
                <td>
                    <div class="action-buttons">
                        ${!isPaid ? `<div class="action-btn" title="دفع" style="color:var(--success);" onclick="markSalaryPaid(${s.id})"><i class="fas fa-check"></i></div>` : ''}
                        <div class="action-btn" title="تعديل" onclick="editSalary(${s.id}, ${s.amount}, '${s.month}', '${s.status}', '${s.notes}')"><i class="fas fa-edit"></i></div>
                        <div class="action-btn" title="حذف" style="color:var(--danger);" onclick="deleteSalary(${s.id})"><i class="fas fa-trash"></i></div>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error loading salaries", e);
    }
}

function editSalary(id, amount, month, status, notes) {
    openAddSalaryForm(id);
    document.getElementById("salary-amount").value = amount;
    document.getElementById("salary-month").value = month;
    document.getElementById("salary-status").value = status;
    document.getElementById("salary-notes").value = notes || "";
}

async function markSalaryPaid(id) {
    if (!confirm("هل أنت متأكد من تسديد هذا الراتب؟")) return;
    try {
        const res = await fetch(`${API_URL}/salaries/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "paid" })
        });
        if (res.ok) await loadSalariesTable();
    } catch (e) { }
}

async function deleteSalary(id) {
    if (!confirm("هل تريد بالتأكيد حذف سجل الراتب؟")) return;
    try {
        const res = await fetch(`${API_URL}/salaries/${id}`, { method: "DELETE" });
        if (res.ok) await loadSalariesTable();
    } catch (e) { }
}

document.addEventListener("DOMContentLoaded", () => {
    // Salary form submit hook
    const sForm = document.getElementById("salary-form");
    if (sForm) {
        sForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = document.getElementById("salary-id").value;
            const user_id = document.getElementById("salary-emp-id").value;
            const month = document.getElementById("salary-month").value;
            const amount = document.getElementById("salary-amount").value;
            const status = document.getElementById("salary-status").value;
            const notes = document.getElementById("salary-notes").value;

            const url = id ? `${API_URL}/salaries/${id}` : `${API_URL}/salaries`;
            const method = id ? "PUT" : "POST";

            try {
                const res = await fetch(url, {
                    method,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ user_id, month, amount, status, notes })
                });
                if (res.ok) {
                    sForm.style.display = "none";
                    await loadSalariesTable();
                } else alert("حدث خطأ");
            } catch (e) { alert("حدث خطأ في الاتصال"); }
        });
    }
});

// ==============================
// Online Orders + Customers (patched)
// Fix: previous file had corrupted bytes after line ~3479 causing JS parse error.
// This block restores the missing functionality without touching backend routes.
// ==============================

// ---------- Online Orders ----------
const ONLINE_ORDERS_KEY = "online_orders_v1";
let onlineOrdersCache = [];
let currentOnlineOrderItems = [];

function readOnlineOrders() {
    try {
        const raw = localStorage.getItem(ONLINE_ORDERS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}
function writeOnlineOrders(list) {
    localStorage.setItem(ONLINE_ORDERS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

async function populateOnlineOrderProductSelect() {
    const select = document.getElementById("oo-product-select");
    if (!select) return;

    // Keep first placeholder option
    select.innerHTML = `<option value="">-- اختر المنتج من المخزون --</option>`;

    try {
        const res = await fetch(`${API_URL}/products`);
        const products = await res.json();
        if (!Array.isArray(products)) return;

        products.forEach(p => {
            const opt = document.createElement("option");
            opt.value = String(p.id);
            const label = `${p.name} (${formatPrice(p.price)}) - مخزون: ${p.stock}`;
            opt.textContent = label;
            // store price & stock for quick access
            opt.dataset.price = String(p.price ?? 0);
            opt.dataset.stock = String(p.stock ?? 0);
            select.appendChild(opt);
        });
    } catch (e) {
        console.error("populateOnlineOrderProductSelect error", e);
    }
}

function openOnlineOrderModal() {
    const modal = document.getElementById("online-order-modal");
    if (!modal) return;

    // Reset form
    const form = document.getElementById("online-order-form");
    if (form) form.reset();

    currentOnlineOrderItems = [];
    renderOnlineOrderItems();

    modal.classList.add("active");
}

function closeOnlineOrderModal() {
    const modal = document.getElementById("online-order-modal");
    if (modal) modal.classList.remove("active");
}

function renderOnlineOrderItems() {
    const tbody = document.getElementById("oo-items-list");
    const totalEl = document.getElementById("oo-total-price");

    if (tbody) tbody.innerHTML = "";

    let total = 0;
    currentOnlineOrderItems.forEach((it, idx) => {
        const lineTotal = Number(it.price) * Number(it.qty);
        total += lineTotal;
        if (tbody) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${it.name}</td>
                <td>${formatPrice(it.price)}</td>
                <td>${it.qty}</td>
                <td>${formatPrice(lineTotal)}</td>
                <td>
                    <button type="button" class="action-btn" onclick="removeOnlineOrderItem(${idx})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });

    if (totalEl) totalEl.textContent = total.toFixed(2);
}

window.removeOnlineOrderItem = function (idx) {
    currentOnlineOrderItems.splice(idx, 1);
    renderOnlineOrderItems();
};

async function addItemToOnlineOrder() {
    const select = document.getElementById("oo-product-select");
    const qtyInput = document.getElementById("oo-product-qty");
    if (!select || !qtyInput) return;

    const productId = select.value;
    const qty = Math.max(1, Number(qtyInput.value) || 1);
    if (!productId) {
        alert("اختر منتجاً أولاً");
        return;
    }

    // Fetch up-to-date product (price/stock)
    let product = null;
    try {
        product = await getProductById(productId);
    } catch {
        product = null;
    }

    if (!product) {
        alert("تعذر تحميل بيانات المنتج");
        return;
    }

    if (Number(product.stock) < qty) {
        alert(`المخزون غير كافٍ. المتاح: ${product.stock}`);
        return;
    }

    // merge if exists
    const existing = currentOnlineOrderItems.find(x => String(x.id) === String(product.id));
    if (existing) {
        existing.qty += qty;
    } else {
        currentOnlineOrderItems.push({
            id: product.id,
            name: product.name,
            price: Number(product.price) || 0,
            qty: qty
        });
    }

    qtyInput.value = 1;
    select.value = "";
    renderOnlineOrderItems();
}

async function saveOnlineOrder(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();

    const nameEl = document.getElementById("oo-customer-name");
    const phoneEl = document.getElementById("oo-customer-phone");
    const addressEl = document.getElementById("oo-customer-address");

    const customer_name = nameEl?.value?.trim();
    const customer_phone = phoneEl?.value?.trim();
    const customer_address = addressEl?.value?.trim();

    if (!customer_name || !customer_phone || !customer_address) {
        alert("من فضلك املأ بيانات العميل كاملة");
        return;
    }

    if (!currentOnlineOrderItems.length) {
        alert("أضف منتجاً واحداً على الأقل");
        return;
    }

    const total = currentOnlineOrderItems.reduce((s, it) => s + (Number(it.price) * Number(it.qty)), 0);

    const now = new Date();
    const order = {
        id: `OO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${now.getTime()}`,
        customer_name,
        customer_phone,
        customer_address,
        items: currentOnlineOrderItems.map(it => ({ ...it })),
        items_count: currentOnlineOrderItems.reduce((s, it) => s + Number(it.qty), 0),
        total: Number(total.toFixed(2)),
        status: "pending",
        created_at: now.toISOString()
    };

    const list = readOnlineOrders();
    list.unshift(order);
    writeOnlineOrders(list);
    onlineOrdersCache = list;

    closeOnlineOrderModal();
    await loadOnlineOrders();

    try {
        await addLog("النظام", "طلب أونلاين", `تم إنشاء طلب أونلاين: ${order.id} - ${formatPrice(order.total)}`);
    } catch { }

    alert("تم حفظ الطلب الأونلاين");
}

function renderOnlineOrdersTable(list) {
    const tbody = document.getElementById("online-orders-table");
    if (!tbody) return;

    if (!Array.isArray(list) || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--gray);">لا توجد طلبات.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    list.forEach(order => {
        const tr = document.createElement("tr");
        const statusBadge = order.status === "delivered"
            ? `<span class="status-badge status-in-stock">تم التوصيل</span>`
            : `<span class="status-badge status-low-stock">قيد التنفيذ</span>`;

        tr.innerHTML = `
            <td>${order.id}</td>
            <td>${order.customer_name}</td>
            <td>${order.customer_phone}</td>
            <td>${order.items_count || 0}</td>
            <td>${formatPrice(order.total || 0)}</td>
            <td>${formatDateTime(order.created_at)}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-outline" onclick="viewOnlineOrder('${order.id.replace(/'/g, "\\'")}')">
                    <i class="fas fa-eye"></i> عرض
                </button>
                <button class="btn btn-success" style="margin-right:8px;" onclick="markOnlineOrderDelivered('${order.id.replace(/'/g, "\\'")}')">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn btn-danger" style="margin-right:8px;" onclick="deleteOnlineOrder('${order.id.replace(/'/g, "\\'")}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadOnlineOrders() {
    onlineOrdersCache = readOnlineOrders();
    renderOnlineOrdersTable(onlineOrdersCache);
}

window.viewOnlineOrder = function (orderId) {
    const order = readOnlineOrders().find(o => o.id === orderId);
    if (!order) return alert("الطلب غير موجود");

    const lines = (order.items || []).map(it => `- ${it.name} x${it.qty} = ${formatPrice(Number(it.price) * Number(it.qty))}`).join("\n");

    alert(
        `طلب: ${order.id}\n` +
        `العميل: ${order.customer_name} (${order.customer_phone})\n` +
        `العنوان: ${order.customer_address}\n\n` +
        `المنتجات:\n${lines}\n\n` +
        `الإجمالي: ${formatPrice(order.total)}\n` +
        `الحالة: ${order.status === 'delivered' ? 'تم التوصيل' : 'قيد التنفيذ'}`
    );
};

window.markOnlineOrderDelivered = async function (orderId) {
    const list = readOnlineOrders();
    const idx = list.findIndex(o => o.id === orderId);
    if (idx === -1) return;
    list[idx].status = "delivered";
    writeOnlineOrders(list);
    await loadOnlineOrders();
    try { await addLog("النظام", "طلب أونلاين", `تم تحديث حالة الطلب ${orderId} إلى تم التوصيل`); } catch { }
};

window.deleteOnlineOrder = async function (orderId) {
    if (!confirm("حذف الطلب؟")) return;
    const list = readOnlineOrders().filter(o => o.id !== orderId);
    writeOnlineOrders(list);
    await loadOnlineOrders();
    try { await addLog("النظام", "طلب أونلاين", `تم حذف الطلب ${orderId}`); } catch { }
};

function initOnlineOrdersSystem() {
    const addBtn = document.getElementById("add-online-order-btn");
    const addItemBtn = document.getElementById("oo-add-item-btn");
    const form = document.getElementById("online-order-form");

    if (addBtn) addBtn.addEventListener("click", async () => {
        await populateOnlineOrderProductSelect();
        openOnlineOrderModal();
    });

    if (addItemBtn) addItemBtn.addEventListener("click", addItemToOnlineOrder);

    if (form) form.addEventListener("submit", saveOnlineOrder);

    // initial load
    loadOnlineOrders();
}

// ---------- Customers + Coupon Settings ----------
const COUPON_SETTINGS_KEY = "coupon_settings_v1";

function readCouponSettings() {
    try {
        const raw = localStorage.getItem(COUPON_SETTINGS_KEY);
        const obj = raw ? JSON.parse(raw) : null;
        return obj && typeof obj === "object" ? obj : { target: 0, discount: 0 };
    } catch {
        return { target: 0, discount: 0 };
    }
}
function writeCouponSettings(settings) {
    const safe = {
        target: Math.max(0, Number(settings?.target) || 0),
        discount: Math.max(0, Number(settings?.discount) || 0)
    };
    localStorage.setItem(COUPON_SETTINGS_KEY, JSON.stringify(safe));
}

function loadCouponSettingsToUI() {
    const s = readCouponSettings();
    const targetEl = document.getElementById("customer-target-amount");
    const discountEl = document.getElementById("customer-discount-value");
    if (targetEl) targetEl.value = s.target || "";
    if (discountEl) discountEl.value = s.discount || "";
}

function saveCouponSettingsFromUI() {
    const targetEl = document.getElementById("customer-target-amount");
    const discountEl = document.getElementById("customer-discount-value");
    const target = Math.max(0, Number(targetEl?.value) || 0);
    const discount = Math.max(0, Number(discountEl?.value) || 0);
    writeCouponSettings({ target, discount });
    alert("تم حفظ إعدادات الكوبون");
}

async function loadCustomersStats() {
    const tbody = document.getElementById("customers-table");
    if (!tbody) return;

    loadCouponSettingsToUI();
    const { target, discount } = readCouponSettings();

    try {
        const res = await fetch(`${API_URL}/sales/invoices`);
        const invoices = await res.json();

        if (!Array.isArray(invoices) || invoices.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--gray);">لا توجد فواتير حالياً.</td></tr>`;
            return;
        }

        const map = new Map();
        invoices.forEach(inv => {
            const name = (inv.customer || "عميل متجر").trim();
            if (!map.has(name)) map.set(name, { name, count: 0, total: 0, invoices: [] });
            const obj = map.get(name);
            obj.count += 1;
            obj.total += Number(inv.total) || 0;
            obj.invoices.push(inv);
        });

        const rows = Array.from(map.values()).sort((a, b) => b.total - a.total);

        tbody.innerHTML = "";
        rows.forEach(c => {
            const eligible = target > 0 ? (c.total >= target) : false;
            const badge = eligible
                ? `<span class="status-badge status-in-stock">نعم</span>`
                : `<span class="status-badge status-low-stock">لا</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${c.name}</td>
                <td>${c.count}</td>
                <td>${formatPrice(c.total)}</td>
                <td>${badge}</td>
                <td>
                    <button class="btn btn-outline" onclick="openCustomerItemsModal('${c.name.replace(/'/g, "\\'")}')">
                        <i class="fas fa-list"></i> المنتجات
                    </button>
                    ${eligible && discount > 0 ? `
                        <button class="btn btn-primary" style="margin-right:8px;" onclick="showCustomerCoupon('${c.name.replace(/'/g, "\\'")}')">
                            <i class="fas fa-ticket-alt"></i> كوبون
                        </button>
                    ` : ""}
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--danger);">حدث خطأ في تحميل بيانات العملاء.</td></tr>`;
    }
}

window.openCustomerItemsModal = async function (customerName) {
    const modal = document.getElementById("customer-items-modal");
    const titleEl = document.getElementById("ci-customer-name");
    const listEl = document.getElementById("ci-items-list");
    if (!modal || !titleEl || !listEl) return;

    titleEl.textContent = customerName;

    try {
        const res = await fetch(`${API_URL}/sales/invoices`);
        const invoices = await res.json();
        const filtered = Array.isArray(invoices) ? invoices.filter(i => (i.customer || "عميل متجر") === customerName) : [];

        // If API returns only summaries, we can still show totals; otherwise try to fetch details per invoice.
        const itemMap = new Map();
        let totalPaid = 0;

        for (const inv of filtered) {
            totalPaid += Number(inv.total) || 0;

            // If inv.items exists
            if (Array.isArray(inv.items)) {
                inv.items.forEach(it => {
                    const key = it.product_name || it.name || "منتج";
                    const q = Number(it.quantity || it.qty || 0);
                    if (!itemMap.has(key)) itemMap.set(key, 0);
                    itemMap.set(key, itemMap.get(key) + q);
                });
            } else if (inv.id) {
                // Try fetch details
                try {
                    const r2 = await fetch(`${API_URL}/sales/invoices/${inv.id}`);
                    const det = await r2.json();
                    if (det && Array.isArray(det.items)) {
                        det.items.forEach(it => {
                            const key = it.product_name || it.name || "منتج";
                            const q = Number(it.quantity || it.qty || 0);
                            if (!itemMap.has(key)) itemMap.set(key, 0);
                            itemMap.set(key, itemMap.get(key) + q);
                        });
                    }
                } catch { }
            }
        }

        const itemsHtml = Array.from(itemMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, qty]) => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:8px 0;"><span>${name}</span><strong>x${qty}</strong></div>`)
            .join("");

        const header = `<div style="margin-bottom:12px;color:var(--gray);">عدد مرات الشراء: <strong>${filtered.length}</strong> | إجمالي المدفوعات: <strong>${formatPrice(totalPaid)}</strong></div>`;

        listEl.innerHTML = header + (itemsHtml || `<div style="color:var(--gray);padding:10px 0;">لا توجد تفاصيل منتجات متاحة.</div>`);

        modal.classList.add("active");

    } catch (e) {
        console.error(e);
        listEl.innerHTML = `<div style="color:var(--danger);">تعذر تحميل بيانات العميل.</div>`;
        modal.classList.add("active");
    }
};

window.showCustomerCoupon = function (customerName) {
    const { target, discount } = readCouponSettings();
    if (!discount) return alert("لم يتم تحديد قيمة الخصم");

    const code = `CUST-${String(customerName).slice(0, 3).toUpperCase()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    alert(
        `كوبون للعميل: ${customerName}\n` +
        `كود: ${code}\n` +
        `قيمة الخصم: ${discount} ج.م\n` +
        (target ? `شرط التأهل: إجمالي مشتريات >= ${target} ج.م` : "")
    );
};

function initCustomersSystem() {
    const saveBtn = document.getElementById("save-coupon-settings-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveCouponSettingsFromUI);

    // Load settings immediately
    loadCouponSettingsToUI();
}

