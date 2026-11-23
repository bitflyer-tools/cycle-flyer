import {div, h, h2, p, section, table, tbody, td, th, thead, tr, VNode} from "@cycle/dom";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {getRecentTrades, recentTradesLimit} from "../../http";
import {executionTime, isMarketExecution, MarketExecution} from "../../models/execution";
import type {Sources} from "./index";
import {throttleLatest} from "./throttleLatest";

const historyRetryDelayMs = 1_000;

export const recentTrades = ({ HTTP, socket }: Pick<Sources, "HTTP" | "socket">,
    leaveTrade$ = Stream.never<void>()) => {
    const historyResult$ = HTTP.select("recent-trades").map((response$) => response$
        .map((response): unknown[] | null => {
            const body = JSON.parse(response.text);
            if (!Array.isArray(body)) { throw new Error("Invalid recent trades history"); }
            return body;
        })
        .replaceError(() => Stream.periodic(historyRetryDelayMs).take(1)
            .mapTo<unknown[] | null>(null).endWhen(socket.reconnect$)),
    ).flatten().endWhen(leaveTrade$);
    const history$ = historyResult$.filter((batch): batch is unknown[] => batch !== null);
    const rows$ = Stream.merge(history$, socket.executionBatch$)
        .fold(mergeTrades, [])
        .compose(dropRepeats());

    return {
        DOM: throttleLatest(rows$, 100).map(render),
        HTTP: Stream.merge(socket.reconnect$, historyResult$.filter((batch) => batch === null))
            .map(getRecentTrades).startWith(getRecentTrades()).endWhen(leaveTrade$),
    };
};

const mergeTrades = (rows: MarketExecution[], batch: unknown[]): MarketExecution[] => {
    const byId = new Map(rows.map((trade) => [trade.id, trade]));
    batch.filter(isMarketExecution).forEach((trade) => {
        if (!byId.has(trade.id)) { byId.set(trade.id, trade); }
    });
    const next = [...byId.values()].sort((a, b) => b.id - a.id).slice(0, recentTradesLimit);
    return next.length === rows.length && next.every((trade, index) => trade === rows[index]) ? rows : next;
};

const render = (rows: MarketExecution[]): VNode => section(".recent-trades",
    { attrs: { "aria-label": "Recent Trades" } }, [
        h2("Recent Trades"),
        rows.length ? div(".recent-trades-scroll", { attrs: { tabindex: "0", "aria-label": "Trade rows" } }, [
            table([
                thead([tr(["Time (UTC)", "Side", "Price (JPY)", "Size (bFX)"]
                    .map((label) => th({ attrs: { scope: "col" } }, label)))]),
                tbody(rows.map(row)),
            ]),
        ]) : p("No recent trades available."),
    ]);

const row = (trade: MarketExecution): VNode => {
    const date = new Date(executionTime(trade.exec_date)).toISOString();
    return tr({ key: trade.id }, [
        td([h("time", { attrs: { datetime: date, title: date } }, date.slice(11, 23))]),
        td(trade.side || "—"),
        td(trade.price.toLocaleString(undefined, { maximumFractionDigits: 20 })),
        td(String(trade.size)),
    ]);
};
