import {DOMSource, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import {soundEnabledStorageKey} from "../../drivers/soundDriver";
import "./index.styl";
import {intent} from "./intent";
import {model, State} from "./model";
import {view} from "./view";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    state: StateSource<State>;
    router: RouterSource;
    storage: StorageSource;
}

export interface Sinks {
    DOM: Stream<VNode>;
    HTTP: Stream<RequestInput|null>;
    state: Stream<Reducer<State>>;
    router: Stream<void>;
    storage: Stream<StorageRequest>;
}

export const Setting = (sources: Sources): Sinks => {
    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.state.stream);
    const storage$ = Stream.merge(
        actions.onApiKeyInputChanged$
            .map((value) => ({ key: "api-key", value }) as StorageRequest),
        actions.onApiSecretInputChanged$
            .map((value) => ({ key: "api-secret", value }) as StorageRequest),
        actions.onSoundToggled$
            .map((enabled) => ({ key: soundEnabledStorageKey, value: enabled.toString() }) as StorageRequest),
    );

    return {
        DOM: view$,
        HTTP: Stream.never(),
        router: Stream.never(),
        state: reducer$,
        storage: storage$,
    };
};
