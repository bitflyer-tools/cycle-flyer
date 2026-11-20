import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getCollateral, getState, hasApiCredentials} from "../../../http";

export const request = (): Stream<string | RequestInput | null> => {
    const collateral = Stream.periodic(15000).startWith(0).filter(hasApiCredentials).map(getCollateral);
    const state = Stream.periodic(30000).mapTo(getState()).startWith(getState());

    return Stream.merge(collateral, state) as Stream<string | RequestInput | null>;
};
