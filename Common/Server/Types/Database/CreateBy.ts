import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";

export default interface CreateBy<TBaseModel extends BaseModel> {
  data: TBaseModel;
  miscDataProps?: JSONObject;
  props: DatabaseCommonInteractionProps;
}
