import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getBoard} from "../../../http";

export const request = (): Stream<RequestInput> => {
    const board = Stream.of(getBoard());
    return Stream.merge(board);
};
