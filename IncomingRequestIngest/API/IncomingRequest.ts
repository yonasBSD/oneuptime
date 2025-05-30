import HTTPMethod from "Common/Types/API/HTTPMethod";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Response from "Common/Server/Utils/Response";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

const processIncomingRequest: RequestHandler = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  try {
    const requestHeaders: Dictionary<string> =
      req.headers as Dictionary<string>;
    const requestBody: string | JSONObject = req.body as string | JSONObject;

    const monitorSecretKeyAsString: string | undefined =
      req.params["secretkey"];

    if (!monitorSecretKeyAsString) {
      throw new BadDataException("Invalid Secret Key");
    }

    const isGetRequest: boolean = req.method === "GET";
    const isPostRequest: boolean = req.method === "POST";

    let httpMethod: HTTPMethod = HTTPMethod.GET;

    if (isGetRequest) {
      httpMethod = HTTPMethod.GET;
    }

    if (isPostRequest) {
      httpMethod = HTTPMethod.POST;
    }

    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: {
        incomingRequestSecretKey: new ObjectID(monitorSecretKeyAsString),
        monitorType: MonitorType.IncomingRequest,
      },
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor || !monitor._id) {
      throw new BadDataException("Monitor not found");
    }

    if (!monitor.projectId) {
      throw new BadDataException("Project not found");
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    const incomingRequest: IncomingMonitorRequest = {
      projectId: monitor.projectId,
      monitorId: new ObjectID(monitor._id.toString()),
      requestHeaders: requestHeaders,
      requestBody: requestBody,
      incomingRequestReceivedAt: now,
      onlyCheckForIncomingRequestReceivedAt: false,
      requestMethod: httpMethod,
      checkedAt: now,
    };

    // process probe response here.
    MonitorResourceUtil.monitorResource(incomingRequest).catch((err: Error) => {
      // do nothing.
      // we don't want to throw error here.
      // we just want to log the error.
      logger.error(err);
    });

    return Response.sendEmptySuccessResponse(req, res);
  } catch (err) {
    return next(err);
  }
};

router.post(
  "/incoming-request/:secretkey",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    processIncomingRequest(req, res, next);
  },
);

router.get(
  "/incoming-request/:secretkey",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    processIncomingRequest(req, res, next);
  },
);

export default router;
