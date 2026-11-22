import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {getBoard} from "../../../http";

export const request = (connected$: Stream<boolean>): Stream<RequestInput> => {
    const connectionRequests$ = connected$.compose(dropRepeats())
        // Let the synchronizer subscribe before the HTTP driver announces the request.
        .map(() => Stream.fromPromise(Promise.resolve(getBoard())))
        .flatten();
    return Stream.merge(connectionRequests$, Stream.periodic(15000).map(getBoard));
};
