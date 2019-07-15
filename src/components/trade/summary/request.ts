import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getCollateral, getState} from "../../../http";

export const request = (): Stream<string | RequestInput | null> => {
    const collateral = Stream.periodic(15000).mapTo(getCollateral()).startWith(getCollateral());
    const state = Stream.periodic(30000).mapTo(getState()).startWith(getState());

    return Stream.merge(collateral, state) as Stream<string | RequestInput | null>;
};
