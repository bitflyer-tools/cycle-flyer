import {makeDOMDriver} from "@cycle/dom";
import {captureClicks, makeHashHistoryDriver, makeHistoryDriver} from "@cycle/history";
import {makeHTTPDriver} from "@cycle/http";
import {run} from "@cycle/run";
import {withState} from "@cycle/state";
import storageDriver from "@cycle/storage";
import {routerify} from "cyclic-router";
import switchPath from "switch-path";
import {Root} from "./components";
import {makeSocketIODriver} from "./drivers/socketIODriver";
import "./index.styl";

// DEBUG
console.log("=== DEBUG INFO ===");
console.log("isElectron:", navigator.userAgent.toLowerCase().includes("electron"));
console.log("window.location.origin:", window.location.origin);
console.log("window.location.href:", window.location.href);
console.log("window.location.protocol:", window.location.protocol);
document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor) {
        console.log("=== CLICK DEBUG ===");
        console.log("anchor.href:", anchor.href);
        console.log("anchor.getAttribute('href'):", anchor.getAttribute("href"));
        console.log("anchor.pathname:", anchor.pathname);
    }
});

const isElectron = navigator.userAgent.toLowerCase().includes("electron");
const historyDriver = isElectron ? makeHashHistoryDriver() : makeHistoryDriver();

run(routerify(withState(Root), switchPath), {
    DOM: makeDOMDriver("#app"),
    HTTP: makeHTTPDriver(),
    history: captureClicks(historyDriver),
    socket: makeSocketIODriver(),
    storage: storageDriver,
});
