import Stream, {Listener} from "xstream";
import {estimateMarketFills, MarketFills} from "../../../models/marketFill";
import {State as BoardState} from "../board";
import {State as OrderState} from "./index";

interface PreviewInput {
    order: OrderState | undefined;
    book: BoardState | undefined;
}

export const marketFillRefreshMs = 100;

export const withMarketFillPreview = (inputs$: Stream<PreviewInput>): Stream<OrderState> => {
    let listener: Listener<PreviewInput>;
    let timer: ReturnType<typeof setTimeout> | undefined;

    return Stream.create<OrderState>({
        start(output) {
            let latest: PreviewInput = { order: undefined, book: undefined };
            let marketFills: MarketFills | undefined;
            const emit = () => {
                if (latest.order) { output.next({ ...latest.order, marketFills }); }
            };
            const refresh = () => {
                clearTimeout(timer);
                timer = undefined;
                const {order, book} = latest;
                marketFills = order && estimateMarketFills(book?.hasBoardSnapshot ? book.board : undefined, order.size);
                emit();
            };

            listener = {
                next(input) {
                    const previous = latest;
                    latest = input;
                    if (!Object.is(previous.order?.size, input.order?.size)
                        || !!previous.book?.hasBoardSnapshot !== !!input.book?.hasBoardSnapshot) {
                        refresh();
                        return;
                    }
                    if (timer === undefined && isBookUpdate(previous.book, input.book)
                        && input.order && Number.isFinite(input.order.size) && input.order.size > 0) {
                        timer = setTimeout(refresh, marketFillRefreshMs);
                    }
                    emit();
                },
                error: (error) => output.error(error),
                complete: () => output.complete(),
            };
            inputs$.addListener(listener);
        },
        stop() {
            clearTimeout(timer);
            timer = undefined;
            inputs$.removeListener(listener);
        },
    });
};

const isBookUpdate = (previous: BoardState | undefined, next: BoardState | undefined): boolean =>
    next?.hasBoardSnapshot === true
    && (previous?.board !== next.board || previous.boardRevision !== next.boardRevision);
