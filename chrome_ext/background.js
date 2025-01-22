chrome.runtime.onInstalled.addListener(() => {
    console.log("확장 프로그램이 설치되었습니다.");
    // 설치 시 저장소 초기화
    chrome.storage.local.set({
        collectedProducts: [],
        uiActive: false, // UI 상태 저장
    });

    // 컨텍스트 메뉴 생성
    if (chrome.contextMenus) {
        chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create({
                id: "analyzeOliveYoung",
                title: "올리브영 분석 도구 테스트하기",
                contexts: ["all"],
                documentUrlPatterns: ["*://*.oliveyoung.co.kr/*"], // 올리브영 URL에서만 메뉴 표시
            });
        });
    }
});

// onClicked 이벤트 리스너는 API가 사용 가능할 때만 등록
if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === "analyzeOliveYoung") {
            chrome.storage.local.set({ uiActive: true }); // UI 활성화 상태 저장
            chrome.tabs.sendMessage(tab.id, { action: "startAnalysis" });
        }
    });
}

// 탭 변경 감지
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
        chrome.storage.local.get(["uiActive"], function (result) {
            if (result.uiActive) {
                chrome.tabs.sendMessage(tabId, { action: "startAnalysis" });
            }
        });
    }
});
