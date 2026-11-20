import {HTTPSource, Response, ResponseStream} from "@cycle/http";
import Stream, {Listener, MemoryStream} from "xstream";
import {apiCredentials} from "../../credentials";
import {PrivateRequest} from "../../http";

type HttpResponse = MemoryStream<Response> & ResponseStream;

export const privateResponses = (http: HTTPSource, category: string): ReturnType<HTTPSource["select"]> =>
    http.select(category)
        .filter((response$) => isCurrentResponse(response$))
        .map(guardResponse);

export const isCurrentResponse = ({ request }: ResponseStream): boolean => {
    const version = (request as PrivateRequest | undefined)?.credentialVersion;
    return version === undefined || version === apiCredentials().version;
};

const guardResponse = (response$: HttpResponse): HttpResponse => {
    let forward: Listener<Response>;
    const guarded$ = Stream.createWithMemory<Response>({
        start(listener) {
            forward = {
                next(response) {
                    if (isCurrentResponse(response$)) { listener.next(response); }
                },
                error(error) {
                    if (isCurrentResponse(response$)) { listener.error(error); } else { listener.complete(); }
                },
                complete: () => listener.complete(),
            };
            response$.addListener(forward);
        },
        stop() { response$.removeListener(forward); },
    });
    return Object.assign(guarded$, { request: response$.request });
};
