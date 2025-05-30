import UserMiddleware from "../Middleware/UserAuthorization";
import ProbeService, {
  Service as ProbeServiceType,
} from "../Services/ProbeService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PositiveNumber from "../../Types/PositiveNumber";
import Probe from "../../Models/DatabaseModels/Probe";

export default class ProbeAPI extends BaseAPI<Probe, ProbeServiceType> {
  public constructor() {
    super(Probe, ProbeService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/global-probes`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const probes: Array<Probe> = await ProbeService.findBy({
            query: {
              isGlobalProbe: true,
            },
            select: {
              name: true,
              description: true,
              lastAlive: true,
              iconFileId: true,
              connectionStatus: true,
            },
            props: {
              isRoot: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
          });

          return Response.sendEntityArrayResponse(
            req,
            res,
            probes,
            new PositiveNumber(probes.length),
            Probe,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
