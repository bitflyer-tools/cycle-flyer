import {makeDOMDriver} from "@cycle/dom";
import {makeHistoryDriver} from "@cycle/history";
import {makeHTTPDriver} from "@cycle/http";
import {run} from "@cycle/run";
import onionify from "cycle-onionify";
import {routerify} from "cyclic-router";
import switchPath from "switch-path";
import {Root} from "./components/index";

run(routerify(onionify(Root), switchPath), {
    DOM: makeDOMDriver("#app"),
    HTTP: makeHTTPDriver(),
    history: makeHistoryDriver(),
});
