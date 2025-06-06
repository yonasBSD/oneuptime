import DatabaseService from "../../../../Services/DatabaseService";
import Query from "../../../Database/Query";
import Select from "../../../Database/Select";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import Text from "../../../../../Types/Text";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export default class FindOneBaseModel<
  TBaseModel extends BaseModel,
> extends ComponentCode {
  private modelService: DatabaseService<TBaseModel> | null = null;

  public constructor(modelService: DatabaseService<TBaseModel>) {
    super();

    const BaseModelComponent: ComponentMetadata | undefined =
      BaseModelComponents.getComponents(modelService.getModel()).find(
        (i: ComponentMetadata) => {
          return (
            i.id ===
            `${Text.pascalCaseToDashes(
              modelService.getModel().tableName!,
            )}-find-one`
          );
        },
      );

    if (!BaseModelComponent) {
      throw new BadDataException(
        "Find one component for " +
          modelService.getModel().tableName +
          " not found.",
      );
    }
    this.setMetadata(BaseModelComponent);
    this.modelService = modelService;
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "success";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "error";
      },
    );

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    try {
      if (!this.modelService) {
        throw options.onError(
          new BadDataException("modelService is undefined."),
        );
      }

      if (!args["query"]) {
        throw options.onError(new BadDataException("Query is undefined."));
      }

      if (typeof args["query"] === "string") {
        args["query"] = JSONFunctions.parse(args["query"] as string);
      }

      if (typeof args["query"] !== "object") {
        throw options.onError(
          new BadDataException("Query is should be of type object."),
        );
      }

      if (this.modelService.getModel().getTenantColumn()) {
        (args["query"] as JSONObject)[
          this.modelService.getModel().getTenantColumn() as string
        ] = options.projectId;
      }

      if (!args["select"]) {
        throw options.onError(
          new BadDataException("Select Fields is undefined."),
        );
      }

      if (typeof args["select"] === "string") {
        args["select"] = JSONFunctions.parse(args["select"] as string);
      }

      if (typeof args["select"] !== "object") {
        throw options.onError(
          new BadDataException("Select Fields is should be of type object."),
        );
      }

      let query: Query<TBaseModel> = args["query"] as Query<TBaseModel>;

      if (query) {
        query = JSONFunctions.deserialize(
          args["query"] as JSONObject,
        ) as Query<TBaseModel>;
      }

      let select: Select<TBaseModel> = args["select"] as Select<TBaseModel>;

      if (select) {
        select = JSONFunctions.deserialize(
          args["select"] as JSONObject,
        ) as Select<TBaseModel>;
      }

      const model: TBaseModel | null = await this.modelService.findOneBy({
        query: query || {},
        select: select,
        props: {
          isRoot: true,
          tenantId: options.projectId,
        },
      });

      return {
        returnValues: {
          model: model
            ? BaseModel.toJSON(model, this.modelService.modelType)
            : null,
        },
        executePort: successPort,
      };
    } catch (err: any) {
      options.log("Error running component");

      options.log(err.message ? err.message : JSON.stringify(err, null, 2));

      return {
        returnValues: {},
        executePort: errorPort,
      };
    }
  }
}
