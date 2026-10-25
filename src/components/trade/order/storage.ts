import {StorageRequest} from "@cycle/storage";
import Stream from "xstream";
import {saveValue} from "../../../storage";
import {State} from "./index";
import {storageKeys} from "./intent";

export const storage = (state$: Stream<State>): Stream<StorageRequest> =>
    Stream.merge(
        saveValue(state$, storageKeys.size, (state) => state.size),
        saveValue(state$, storageKeys.priceWidth, (state) => state.ifdocoOrder.width),
        saveValue(state$, storageKeys.ratio, (state) => state.ifdocoOrder.ratio),
    );
