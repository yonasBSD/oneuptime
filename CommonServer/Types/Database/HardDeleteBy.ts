import Query from "./Query";
import BaseModel from "Common/Models/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface HardDeleteBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
