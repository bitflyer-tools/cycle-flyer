import {makeDOMDriver} from "@cycle/dom";
import {captureClicks, HistoryDriver, HistoryInput, makeHistoryDriver} from "@cycle/history";
import {makeHTTPDriver} from "@cycle/http";
import {run} from "@cycle/run";
import {withState} from "@cycle/state";
import storageDriver from "@cycle/storage";
import {routerify} from "cyclic-router";
import Stream from "xstream";
import switchPath from "switch-path";
import {Root} from "./components";
import {makeSocketIODriver} from "./drivers/socketIODriver";
import "./index.styl";

/**
 * Normalize pathname for SPA routing in Electron file:// protocol
 *
 * Input patterns and expected outputs:
 *
 * [http:// or https:// protocol - Browser/Dev]
 *   "/"                                      → "/"
 *   "/setting"                               → "/setting"
 *   "/unknown"                               → "/unknown"
 *
 * [file:// protocol - Electron Windows]
 *   "/C:/Users/.../public/index.html"        → "/"       (initial load)
 *   "/C:/setting"                            → "/setting" (link click)
 *   "/C:/"                                   → "/"       (link click)
 *   "/C:/some/file.txt"                      → "/some/file.txt" (local file link)
 *   "file:///C:/Users/.../public/index.html" → "/"       (full URL as pathname)
 *   "file:///C:/setting"                     → "/setting" (full URL as pathname)
 *
 * [file:// protocol - Electron macOS/Linux]
 *   "/Users/.../public/index.html"           → "/"       (initial load)
 *   "/home/.../public/index.html"            → "/"       (initial load)
 *   "/setting"                               → "/setting" (link click)
 *   "/"                                      → "/"       (link click)
 *   "/some/path/file.txt"                    → "/some/path/file.txt" (local file link)
 */
const normalizePathname = (pathname: string): string => {
    // Windows drive letter: /C:/... or file:///C:/...
    const driveLetterMatch = pathname.match(/(^|file:\/\/)\/[A-Za-z]:/);
    if (driveLetterMatch) {
        const withoutDrive = pathname.slice(driveLetterMatch.index! + driveLetterMatch[0].length);
        if (withoutDrive.endsWith("/public/index.html")) return "/";
        return withoutDrive;
    }

    // macOS/Linux initial load: /path/to/public/index.html
    if (pathname.endsWith("/public/index.html")) return "/";

    return pathname;
};

const wrapHistoryDriver = (driver: HistoryDriver): HistoryDriver =>
    (sink$: Stream<HistoryInput>) => {
        const source$ = driver(sink$);
        return source$.map((location) => ({
            ...location,
            pathname: normalizePathname(location.pathname),
        }));
    };

run(routerify(withState(Root), switchPath), {
    DOM: makeDOMDriver("#app"),
    HTTP: makeHTTPDriver(),
    history: captureClicks(wrapHistoryDriver(makeHistoryDriver())),
    socket: makeSocketIODriver(),
    storage: storageDriver,
});
