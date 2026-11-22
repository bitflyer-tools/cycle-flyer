import Stream, {Listener} from "xstream";

export const throttleLatest = <T>(source$: Stream<T>, interval: number): Stream<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: T | undefined;
    let listener: Listener<T>;

    return Stream.create<T>({
        start(output) {
            const emit = (state: T) => {
                timer = setTimeout(() => {
                    timer = undefined;
                    const latest = pending;
                    pending = undefined;
                    if (latest !== undefined) { emit(latest); }
                }, interval);
                output.next(state);
            };

            listener = {
                next(state) {
                    if (timer === undefined) { emit(state); }
                    else { pending = state; }
                },
                error: (error) => output.error(error),
                complete() {
                    if (pending !== undefined) { output.next(pending); }
                    output.complete();
                },
            };
            source$.addListener(listener);
        },
        stop() {
            clearTimeout(timer);
            timer = undefined;
            pending = undefined;
            source$.removeListener(listener);
        },
    });
};
