import {makeDOMDriver} from "@cycle/dom";
import {captureClicks, makeHistoryDriver} from "@cycle/history";
import {makeHTTPDriver} from "@cycle/http";
import {run} from "@cycle/run";
import storageDriver from "@cycle/storage";
import onionify from "cycle-onionify";
import {routerify} from "cyclic-router";
import switchPath from "switch-path";
import {Root} from "./components/index";
import {makeSocketIODriver} from "./drivers/socketIODriver";
import "./index.styl";

run(routerify(onionify(Root), switchPath), {
    DOM: makeDOMDriver("#app"),
    HTTP: makeHTTPDriver(),
    history: captureClicks(makeHistoryDriver()),
    socket: makeSocketIODriver(),
    storage: storageDriver,
});
