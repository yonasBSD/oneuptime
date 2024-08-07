import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";
import { FindOptionsRelations } from "typeorm";

type RelationSelect<TBaseModel extends BaseModel> =
  | FindOptionsRelations<TBaseModel>
  | JSONObject;

export default RelationSelect;
