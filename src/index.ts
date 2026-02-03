import {makeDOMDriver} from "@cycle/dom";
import {captureClicks, HistoryDriver, makeHistoryDriver} from "@cycle/history";
import {makeHTTPDriver} from "@cycle/http";
import {run} from "@cycle/run";
import {withState} from "@cycle/state";
import storageDriver from "@cycle/storage";
import {routerify} from "cyclic-router";
import switchPath from "switch-path";
import Stream from "xstream";
import {Root} from "./components";
import {makeSocketIODriver} from "./drivers/socketIODriver";
import "./index.styl";

const normalizePathname = (pathname: string): string =>
    pathname.replace(/^\/[A-Za-z]:/, "");

const wrapHistoryDriver = (driver: HistoryDriver): HistoryDriver => (sink$) => {
    const normalized$ = sink$.map((input) => {
        if (typeof input === "string") {
            return normalizePathname(input);
        }
        if (input && typeof input === "object" && "pathname" in input) {
            return {...input, pathname: normalizePathname(input.pathname)};
        }
        return input;
    });
    return driver(normalized$);
};

run(routerify(withState(Root), switchPath), {
    DOM: makeDOMDriver("#app"),
    HTTP: makeHTTPDriver(),
    history: captureClicks(wrapHistoryDriver(makeHistoryDriver())),
    socket: makeSocketIODriver(),
    storage: storageDriver,
});
