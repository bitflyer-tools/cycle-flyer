import {RequestOptions} from "@cycle/http";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {getBoard} from "../../../http";

export const request = (connected$: Stream<boolean>): Stream<string | RequestOptions | null> =>
    connected$
        .startWith(false)
        .compose(dropRepeats())
        .map(() => Stream.merge(
            // Let the synchronizer subscribe before the HTTP driver announces the request.
            Stream.fromPromise(Promise.resolve(getBoard())),
            Stream.periodic(15000).map(getBoard),
        ))
        .flatten();
