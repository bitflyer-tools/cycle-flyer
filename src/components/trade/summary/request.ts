import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {credentialAvailability, hasApiCredentials} from "../../../credentials";
import {getCollateral, getState} from "../../../http";

export const request = (): Stream<string | RequestInput | null> => {
    const collateral = Stream.merge(Stream.periodic(15000), credentialAvailability().filter(Boolean))
        .filter(hasApiCredentials).map(getCollateral);
    const state = Stream.periodic(30000).map(() => getState()).startWith(getState());

    return Stream.merge(collateral, state) as Stream<string | RequestInput | null>;
};
