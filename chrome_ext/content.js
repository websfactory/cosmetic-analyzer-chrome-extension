console.log("content.js 로드됨"); // 스크립트 로드 확인
// 메시지 리스너 추가
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startAnalysis") {
        console.log("분석 시작");
        createFloatingUI();
    }
});

function createFloatingUI() {
    // 이미 존재하는 컨테이너가 있다면 제거
    const existingContainer = document.querySelector(".floating-container");
    if (existingContainer) {
        existingContainer.remove();
    }

    // URL 체크
    const currentUrl = window.location.href;
    const isProductPage = currentUrl.startsWith("https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do");

    const container = document.createElement("div");
    container.className = "floating-container";
    console.log("새 컨테이너 생성");

    // URL에 따라 완전히 다른 버튼 세트 구성
    const buttonsHtml = isProductPage
        ? `
      <button id="analyzeIngredients" class="action-button">제품 성분 분석</button>
      `
        : `
      <button id="collectButton" class="action-button">현재 페이지에서 데이터 수집</button>
      <button id="exportButton" class="action-button">엑셀로 데이터 내보내기</button>
      <button id="clearButton" class="action-button" style="background: #dc3545">데이터 초기화</button>
      `;

    container.innerHTML = `
    <button class="close-button" id="closeButton">X</button>
    <div class="button-container">
        ${buttonsHtml}
    </div>
    <div id="spinner" class="spinner"></div>
    <div id="notification" class="notification"></div>
    <div id="previewContainer" class="preview-container"></div>
    <div id="totalCount" style="margin-top: 10px; font-size: 12px; color: #666;"></div>
    `;

    document.body.appendChild(container);

    // 닫기 버튼 이벤트 리스너 추가
    const closeButton = container.querySelector("#closeButton");
    closeButton.onclick = function () {
        container.remove();
        chrome.storage.local.set({ uiActive: false });
    };
    setupEventListeners();
    updateTotalCount();
}

function setupEventListeners() {
    const collectButton = document.getElementById("collectButton");
    const exportButton = document.getElementById("exportButton");
    const clearButton = document.getElementById("clearButton");
    const analyzeIngredientsBtn = document.getElementById("analyzeIngredients");

    if (collectButton && exportButton && clearButton) {
        collectButton.addEventListener("click", async () => {
            console.log("수집 버튼 클릭됨");
            showSpinner(true);
            try {
                const newProducts = await collectProducts();
                const { collectedProducts = [] } = await chrome.storage.local.get("collectedProducts");

                // 중복 제거를 위한 Set 사용
                const uniqueProducts = removeDuplicateProducts([...collectedProducts, ...newProducts]);

                await chrome.storage.local.set({ collectedProducts: uniqueProducts });

                const newCount = newProducts.length;
                const totalCount = uniqueProducts.length;
                const withIngredientsCount = uniqueProducts.filter((p) => p.ingredients).length;

                showNotification(`${newCount}개의 새로운 데이터가 수집되었습니다.\n` + `총 ${totalCount}개 중 ${withIngredientsCount}개의 성분 정보 포함`, "success");

                showPreview(newProducts);
                updateTotalCount();
            } catch (error) {
                console.error("데이터 수집 중 오류:", error);
                showNotification("데이터 수집 중 오류가 발생했습니다.", "error");
            }
            showSpinner(false);
        });

        clearButton.addEventListener("click", async () => {
            try {
                await chrome.storage.local.set({ collectedProducts: [] });
                showNotification("데이터가 초기화되었습니다.", "success");
                updateTotalCount();
                document.getElementById("previewContainer").style.display = "none";
            } catch (error) {
                console.error("데이터 초기화 중 오류:", error);
                showNotification("데이터 초기화 중 오류가 발생했습니다.", "error");
            }
        });

        exportButton.addEventListener("click", async () => {
            console.log("내보내기 버튼 클릭됨");
            try {
                const { collectedProducts = [] } = await chrome.storage.local.get("collectedProducts");
                if (!collectedProducts || collectedProducts.length === 0) {
                    showNotification("내보낼 데이터가 없습니다. 먼저 데이터를 수집해주세요.", "error");
                    return;
                }
                await exportToXLSX(collectedProducts);
            } catch (error) {
                console.error("데이터 내보내기 중 오류:", error);
                showNotification("데이터 내보내기 중 오류가 발생했습니다.", "error");
            }
        });
    }

    if (analyzeIngredientsBtn) {
        analyzeIngredientsBtn.addEventListener("click", async () => {
            try {
                showSpinner(true);
                const url = new URL(window.location.href);
                const goodsNo = url.searchParams.get("goodsNo");

                if (!goodsNo) {
                    throw new Error("상품 번호를 찾을 수 없습니다.");
                }

                // 성분 정보 가져오기
                const result = await fetchIngredients(goodsNo, "001");

                if (result.status === "success" && result.ingredients) {
                    // 성분 분석 정보 로컬 스토리지에 저장
                    chrome.storage.local.get(["analyzedProducts"], function (data) {
                        const products = data.analyzedProducts || [];
                        const productWithIngredients = {
                            goodsNo: goodsNo,
                            ingredients: result.ingredients,
                            analyzedDate: new Date().toISOString(),
                        };
                        products.push(productWithIngredients);
                        chrome.storage.local.set({ analyzedProducts: products });
                    });

                    // 서버로 성분 분석 요청
                    const analysisResult = await fetchIngredientsInfoWithServer(result.ingredients);

                    // 여러 제품이 발견된 경우
                    if (analysisResult.data.status === "info" && analysisResult.data.products) {
                        showNotification("여러 제품이 발견되었습니다. 현재 개별 제품에 대한 분석만 가능합니다.", "info");
                        return;
                    }

                    // 분석 결과 임시 저장
                    chrome.storage.local.set({
                        currentAnalysis: {
                            goodsNo: goodsNo,
                            result: analysisResult.data,
                            date: new Date().toISOString(),
                        },
                    });
                    showAnalysisResults(analysisResult.data);
                } else {
                    throw new Error("성분 정보를 가져오는데 실패했습니다.");
                }
            } catch (error) {
                console.error("성분 분석 중 오류:", error);
                showNotification(error.message, "error");
            } finally {
                showSpinner(false);
            }
        });
    }
}

// 중복 제거 함수
function removeDuplicateProducts(products) {
    // goods_no를 기준으로 중복 제거
    const uniqueMap = new Map();
    products.forEach((product) => {
        if (product.goods_no) {
            uniqueMap.set(product.goods_no, product);
        }
    });
    return Array.from(uniqueMap.values());
}

function showSpinner(show) {
    document.getElementById("spinner").style.display = show ? "block" : "none";
}

// 총 수집된 데이터 수 업데이트 함수
async function updateTotalCount() {
    const { collectedProducts = [] } = await chrome.storage.local.get("collectedProducts");
    const totalCount = document.getElementById("totalCount");
    if (totalCount) {
        totalCount.textContent = `총 수집된 데이터: ${collectedProducts.length}개`;
    }
}

function showNotification(message, type) {
    const notification = document.getElementById("notification");
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = "block";

    // 10초 후 알림 숨기기
    setTimeout(() => {
        notification.style.display = "none";
    }, 10000);
}

function showPreview(products) {
    const previewContainer = document.getElementById("previewContainer");
    previewContainer.style.display = "block";

    // 미리보기 데이터 생성
    const previewHTML = products
        .slice(0, 3)
        .map(
            (product) => `
        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
            <div><strong>${product.name || "이름 없음"}</strong></div>
            <div>브랜드: ${product.brand || "-"}</div>
            <div>가격: ${product.current_price || "-"}</div>
        </div>
    `
        )
        .join("");

    previewContainer.innerHTML = `
        <h4 style="margin-top: 0;">수집된 데이터 미리보기 (처음 3개)</h4>
        ${previewHTML}
        <div style="color: #666;">총 ${products.length}개의 상품이 수집되었습니다.</div>
    `;
}

async function exportToXLSX(data) {
    try {
        // 워크북 생성
        const wb = XLSX.utils.book_new();

        // 워크시트 생성
        const ws = XLSX.utils.json_to_sheet(data);

        // 열 너비 자동 조정
        const colWidths = {};
        const columnHeaders = Object.keys(data[0]);

        // 각 열의 최대 너비 계산
        columnHeaders.forEach((header, index) => {
            colWidths[index] = Math.max(header.length, ...data.map((row) => String(row[header] || "").length));
        });

        // 열 너비 설정
        ws["!cols"] = Object.values(colWidths).map((width) => ({
            wch: Math.min(width + 2, 50), // 최대 50자로 제한
        }));

        // 워크시트를 워크북에 추가
        XLSX.utils.book_append_sheet(wb, ws, "상품 데이터");

        // 파일명 생성 (현재 날짜 포함)
        const fileName = `oliveyoung_products_${new Date().toISOString().slice(0, 10)}.xlsx`;

        // 파일 다운로드
        XLSX.writeFile(wb, fileName);

        showNotification("엑셀 파일이 다운로드되었습니다.", "success");
    } catch (error) {
        console.error("엑셀 파일 생성 중 오류:", error);
        showNotification("엑셀 파일 생성 중 오류가 발생했습니다.", "error");
    }
}

async function collectProducts() {
    console.log("데이터 수집 시작");

    const productLists = document.querySelectorAll("ul.cate_prd_list");
    if (!productLists.length) {
        console.log("상품 리스트를 찾을 수 없음");
        throw new Error("상품 리스트를 찾을 수 없습니다.");
    }

    const allProducts = [];

    for (const productList of productLists) {
        const productItems = productList.querySelectorAll("li");
        console.log(`${productItems.length}개의 상품 발견`);

        for (const item of productItems) {
            const productInfo = extractProductInfo(item);

            // 상품 번호와 아이템 번호가 있는 경우에만 성분 정보 수집
            if (productInfo.goods_no && productInfo.item_no) {
                const ingredientInfo = await fetchIngredients(productInfo.goods_no, productInfo.item_no);
                if (ingredientInfo.status === "success") {
                    productInfo.ingredients = ingredientInfo.ingredients;
                }
            }

            if (Object.keys(productInfo).length > 0) {
                allProducts.push(productInfo);
            }
        }
    }

    console.log(`총 ${allProducts.length}개의 상품 정보 수집 완료`);
    return allProducts;
}

function extractProductInfo(productItem) {
    try {
        const productInfo = {};

        // 상품 썸네일 정보
        const thumbLink = productItem.querySelector("a.prd_thumb");
        if (thumbLink) {
            productInfo.product_url = thumbLink.href || "";
            productInfo.goods_no = thumbLink.getAttribute("data-ref-goodsno") || "";
            productInfo.item_no = thumbLink.getAttribute("data-ref-itemno") || "";
            productInfo.disp_cat_no = thumbLink.getAttribute("data-ref-dispcatno") || "";

            // 만약 goods_no가 비어있다면 장바구니 버튼에서 정보 추출 시도
            if (!productInfo.goods_no) {
                const cartButton = productItem.querySelector("button.cartBtn");
                if (cartButton) {
                    productInfo.goods_no = cartButton.getAttribute("data-ref-goodsno") || "";
                    productInfo.item_no = cartButton.getAttribute("data-ref-itemno") || "";
                    productInfo.disp_cat_no = cartButton.getAttribute("data-ref-dispcatno") || "";

                    // 장바구니 버튼에서 추가로 얻을 수 있는 정보들도 수집
                    productInfo.goods_name = cartButton.getAttribute("data-ref-goodsnm") || "";
                    productInfo.goods_brand = cartButton.getAttribute("data-ref-goodsbrand") || "";
                    productInfo.goods_category = cartButton.getAttribute("data-ref-goodscategory") || "";
                    productInfo.goods_tracking_no = cartButton.getAttribute("data-ref-goodstrackingno") || "";
                    productInfo.entry_source = cartButton.getAttribute("data-ref-entrysource") || "";
                    productInfo.corner_nm = cartButton.getAttribute("data-ref-cornernm") || "";
                }
            }
        }

        // 나머지 정보 추출 (Python 코드와 동일한 로직)
        const thumbFlag = productItem.querySelector("span.thumb_flag");
        if (thumbFlag) {
            productInfo.thumb_flag_text = thumbFlag.textContent.trim();
        }

        const img = productItem.querySelector("img");
        if (img) {
            productInfo.image_url = img.src || "";
        }

        const brand = productItem.querySelector("span.tx_brand");
        productInfo.brand = brand ? brand.textContent.trim() : "";

        const name = productItem.querySelector("p.tx_name");
        productInfo.name = name ? name.textContent.trim() : "";

        const orgPrice = productItem.querySelector("span.tx_org span.tx_num");
        const curPrice = productItem.querySelector("span.tx_cur span.tx_num");
        productInfo.original_price = orgPrice ? orgPrice.textContent.trim() : "";
        productInfo.current_price = curPrice ? curPrice.textContent.trim() : "";

        const flags = Array.from(productItem.querySelectorAll("p.prd_flag span.icon_flag"));
        productInfo.flags = flags.map((flag) => flag.textContent.trim());

        const reviewPoint = productItem.querySelector("span.review_point span.point");
        if (reviewPoint) {
            const style = reviewPoint.getAttribute("style") || "";
            productInfo.rating_percent = style.replace("width:", "").replace("%", "");
            productInfo.rating_text = reviewPoint.textContent.trim();
        }

        const reviewCount = productItem.querySelector("p.prd_point_area");
        if (reviewCount) {
            const reviewText = reviewCount.textContent.trim();
            const match = reviewText.match(/\(([^)]+)\)/);
            if (match) {
                productInfo.review_count = match[1];
            }
        }

        const zzimButton = productItem.querySelector("button.btn_zzim");
        if (zzimButton) {
            productInfo.goods_tracking_no = zzimButton.getAttribute("data-ref-goodstrackingno") || "";
            productInfo.goods_type = zzimButton.getAttribute("data-ref-goodstype") || "";
            productInfo.corner_nm = zzimButton.getAttribute("data-ref-cornernm") || "";
        }

        productInfo.has_cart_button = !!productItem.querySelector("button.cartBtn");
        productInfo.has_new_window_button = !!productItem.querySelector("button.btn_new_pop");

        return productInfo;
    } catch (error) {
        console.error("상품 정보 추출 중 에러:", error);
        return {};
    }
}

function showAnalysisResults(analysisData) {
    console.log("분석 데이터:", analysisData);

    const previewContainer = document.getElementById("previewContainer");
    // 미리보기 컨테이너를 보이게 설정
    previewContainer.style.display = "block";

    const tabsHtml = `
        <div class="analysis-tabs">
            <button class="tab-button active" data-tab="ingredients">성분 구성</button>
            <button class="tab-button" data-tab="purpose">목적별</button>
            <button class="tab-button" data-tab="chat">AI 문의</button>
        </div>
        <div class="tab-content">
            <div id="ingredients-content" class="tab-pane active">
                <div class="ingredients-list"></div>
            </div>
            <div id="purpose-content" class="tab-pane">
                <div class="purpose-groups"></div>
            </div>
            <div id="chat-content" class="tab-pane">
                <div class="chat-container">
                    <div class="chat-messages"></div>
                    <div class="chat-input-container">
                        <input type="text" class="chat-input" placeholder="성분에 대해 궁금한 점을 물어보세요">
                        <button class="chat-send-button">전송</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    previewContainer.innerHTML = tabsHtml;

    const style = document.createElement("style");
    style.textContent = `
        .analysis-tabs {
            display: flex;
            border-bottom: 1px solid #ddd;
            margin-bottom: 15px;
        }

        .tab-button {
            padding: 8px 16px;
            border: none;
            background: none;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            color: #666;
            font-weight: 500;
        }
        
        .tab-button.active {
            border-bottom: 2px solid #9bce26;
            color: #9bce26;
        }

        .tab-content {
            max-height: 400px;
            overflow-y: auto;
        }
        
        .tab-pane {
            display: none;
        }
        
        .tab-pane.active {
            display: block;
        }
        
        .ingredients-list, .purpose-groups {
            padding: 10px;
        }
        
        .ingredient-item {
            padding: 12px;
            border-bottom: 1px solid #eee;
            line-height: 1.5;
        }
        
        .ingredient-name {
            font-weight: bold;
            color: #333;
            margin-bottom: 4px;
        }
        
        .ingredient-info {
            color: #666;
            font-size: 0.9em;
        }
        
        .ewg-grade {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            background: #f0f0f0;
            margin-left: 8px;
        }
        
        .purpose-group {
            margin-bottom: 20px;
            padding: 15px;
            border: 1px solid #eee;
            border-radius: 4px;
        }
        
        .purpose-title {
            font-weight: bold;
            margin-bottom: 12px;
            color: #333;
            font-size: 1.1em;
        }
        
        .purpose-info {
            margin-bottom: 10px;
            color: #666;
            font-size: 0.9em;
        }
        
        .purpose-ingredients {
            margin-top: 10px;
            padding: 10px;
            background: #f9f9f9;
            border-radius: 4px;
        }

        .purpose-ingredient-item {
            display: inline-block;
            margin: 2px 4px;
            padding: 2px 6px;
            background: #fff;
            border: 1px solid #eee;
            border-radius: 3px;
            font-size: 0.9em;
        }

        /* 챗봇 관련 스타일 */
    .chat-container {
        display: flex;
        flex-direction: column;
        height: 400px;
    }

    .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        background: #f9f9f9;
        border-radius: 4px;
        margin-bottom: 10px;
    }

    .chat-message {
        margin-bottom: 15px;
        max-width: 80%;
        display: flex;
        align-items: flex-start;
        gap: 8px;
    }

    .message-icon {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
    }

    .message-content {
        padding: 8px 12px;
        border-radius: 15px;
    }

    .user-message {
        margin-left: auto;
        flex-direction: row-reverse;
    }

    .user-message .message-content {
        background: #9bce26;
        color: white;
        border-radius: 15px 15px 0 15px;
    }

    .ai-message {
        margin-right: auto;
    }

    .ai-message .message-content {
        background: white;
        border: 1px solid #eee;
        border-radius: 15px 15px 15px 0;
    }

    .chat-input-container {
        display: flex;
        gap: 8px;
        padding: 10px;
        background: white;
        border-top: 1px solid #eee;
    }

    .chat-input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 20px;
        outline: none;
    }

    .chat-input:focus {
        border-color: #9bce26;
    }

    .chat-send-button {
        padding: 8px 16px;
        background: #9bce26;
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
    }

    .chat-send-button:hover {
        background: #8bbd1f;
    }

    `;
    document.head.appendChild(style);
    // 채팅 기능 초기화
    initializeChat();

    // 탭 전환 이벤트 리스너
    const tabButtons = previewContainer.querySelectorAll(".tab-button");
    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            tabButtons.forEach((btn) => btn.classList.remove("active"));
            button.classList.add("active");

            const tabId = button.dataset.tab;
            const tabPanes = previewContainer.querySelectorAll(".tab-pane");
            tabPanes.forEach((pane) => pane.classList.remove("active"));
            document.getElementById(`${tabId}-content`).classList.add("active");
        });
    });

    // 성분 구성 데이터 표시
    const ingredientsList = previewContainer.querySelector(".ingredients-list");
    analysisData.data.ingredients.forEach((ingredient) => {
        console.log("성분 데이터:", ingredient);
        const ingredientItem = document.createElement("div");
        ingredientItem.className = "ingredient-item";
        ingredientItem.innerHTML = `
            <div class="ingredient-name">
                ${ingredient.korean_name} (${ingredient.english_name})
                <span class="ewg-grade">EWG ${ingredient.ewg_grade}</span>
            </div>
            <div class="ingredient-info">
                <div>정의: ${ingredient.definition || "정보 없음"}</div>
                <div>용도: ${ingredient.purpose || "정보 없음"}</div>
            </div>
        `;
        ingredientsList.appendChild(ingredientItem);
    });

    // 목적별 성분 데이터 표시
    const purposeGroups = previewContainer.querySelector(".purpose-groups");
    console.log("목적별 그룹 데이터:", analysisData.data.purposeGroups);

    Object.entries(analysisData.data.purposeGroups).forEach(([purpose, groupData]) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "purpose-group";

        // 성분 목록을 EWG 등급과 함께 표시하는 HTML 생성
        const ingredientsHtml = groupData.ingredients.map((ing) => `<span class="purpose-ingredient-item">${ing.name} ${ing.ewg_grade ? `(EWG ${ing.ewg_grade})` : ""}</span>`).join(" ");

        groupDiv.innerHTML = `
            <div class="purpose-title">${purpose}</div>
            <div class="purpose-info">
                <div>주요 기능: ${groupData.purpose_main || "정보 없음"}</div>
                <div>관련 특성: ${groupData.purpose_related_features || "정보 없음"}</div>
                <div>상세 설명: ${groupData.purpose_detailed_description || "정보 없음"}</div>
            </div>
            <div class="purpose-ingredients">
                포함 성분: ${ingredientsHtml}
            </div>
        `;
        purposeGroups.appendChild(groupDiv);
    });
}

function initializeChat() {
    const chatInput = document.querySelector(".chat-input");
    const sendButton = document.querySelector(".chat-send-button");
    const chatMessages = document.querySelector(".chat-messages");

    // SVG 아이콘 추가
    const iconsHtml = document.querySelector("#chat-icons");
    if (!iconsHtml) {
        document.body.insertAdjacentHTML(
            "beforeend",
            `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="display: none;">
            <symbol id="robot-icon">
                <path d="M12,2A2,2 0 0,1 14,4V6H20A2,2 0 0,1 22,8V16A2,2 0 0,1 20,18H18V20A2,2 0 0,1 16,22H8A2,2 0 0,1 6,20V18H4A2,2 0 0,1 2,16V8A2,2 0 0,1 4,6H10V4A2,2 0 0,1 12,2M12,4V6H16V8H14V10H16V12H14V14H16V16H8V14H10V12H8V10H10V8H8V6H12V4M4,8V16H6V8H4M18,8V16H20V8H18Z"/>
            </symbol>
            <symbol id="user-icon">
                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,8.39C13.57,9.4 15.42,10 17.42,10C18.2,10 18.95,9.91 19.67,9.74C19.88,10.45 20,11.21 20,12C20,16.41 16.41,20 12,20C9,20 6.39,18.34 5,15.89L6.75,14V13A1.25,1.25 0 0,1 8,11.75A1.25,1.25 0 0,1 9.25,13V14H12M16,11.75A1.25,1.25 0 0,0 14.75,13A1.25,1.25 0 0,0 16,14.25A1.25,1.25 0 0,0 17.25,13A1.25,1.25 0 0,0 16,11.75Z"/>
            </symbol>
        </svg>
        `
        );
    }

    // 시작 메시지 추가
    const titleElement = document.querySelector("title");
    let productName = "이 제품";
    if (titleElement) {
        const titleText = titleElement.textContent;
        productName = titleText.split("|")[0].trim();
    }

    addMessage(`안녕하세요! ${productName}에 대해 궁금한 점이 있으신가요?`, "ai");

    function addMessage(message, type) {
        const messageDiv = document.createElement("div");
        messageDiv.className = `chat-message ${type}-message`;

        const iconSvg = `<svg class="message-icon" fill="${type === "ai" ? "#9bce26" : "#666"}">
            <use href="#${type === "ai" ? "robot-icon" : "user-icon"}"/>
        </svg>`;

        messageDiv.innerHTML = `
            ${iconSvg}
            <div class="message-content">${message}</div>
        `;

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function sendMessage() {
        const message = chatInput.value.trim();
        if (message) {
            addMessage(message, "user");

            // 예시 AI 응답 (실제 구현 시 이 부분이 API 호출로 대체됨)
            addMessage("API 연동 전입니다. 실제 구현 시 이 메시지가 API 응답으로 대체됩니다.", "ai");

            chatInput.value = "";
        }
    }

    sendButton.addEventListener("click", sendMessage);
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            sendMessage();
        }
    });
}

// API 요청 및 성분 정보 수집 함수
async function fetchIngredients(goodsNo, itemNo) {
    try {
        const url = "https://www.oliveyoung.co.kr/store/goods/getGoodsArtcAjax.do";
        const formData = new FormData();
        formData.append("goodsNo", goodsNo);
        formData.append("itemNo", itemNo);
        formData.append("pkgGoodsYn", "N");

        const response = await fetch(url, {
            method: "POST",
            body: formData,
            // 현재 브라우저의 쿠키를 함께 전송
            credentials: "include",
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        let ingredients = null;
        const detailInfoLists = doc.querySelectorAll("dl.detail_info_list");

        for (const dl of detailInfoLists) {
            const dt = dl.querySelector("dt");
            if (dt && dt.textContent.includes("화장품법에 따라 기재해야 하는 모든 성분")) {
                const dd = dl.querySelector("dd");
                if (dd) {
                    ingredients = dd.textContent.trim();
                }
                break;
            }
        }

        return {
            status: "success",
            ingredients: ingredients,
        };
    } catch (error) {
        console.error("성분 정보 수집 중 오류:", error);
        return {
            status: "error",
            error: error.message,
        };
    }
}

async function fetchIngredientsInfoWithServer(ingredients) {
    console.log("fetchIngredientsInfoWithServer 호출됨. 요청 데이터:", ingredients);
    try {
        const response = await fetch("https://websfactory.co.kr/api/ai/cosmetic_ingredients", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ ingredients }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "서버 분석 중 오류가 발생했습니다.");
        }

        const jsonResponse = await response.json();

        if (jsonResponse.status === "error") {
            throw new Error(jsonResponse.message);
        }

        return {
            type: "json",
            data: jsonResponse,
        };
    } catch (error) {
        console.error("Error:", error);
        throw error;
    }
}

// // 페이지 로드 이벤트 리스너 수정
// document.addEventListener("DOMContentLoaded", () => {
//   console.log("DOMContentLoaded 이벤트 발생");
//   createFloatingUI();
// });

// // 페이지가 이미 로드된 경우를 위한 즉시 실행
// if (
//   document.readyState === "complete" ||
//   document.readyState === "interactive"
// ) {
//   console.log("페이지가 이미 로드됨. UI 즉시 생성");
//   createFloatingUI();
// }
