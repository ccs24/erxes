import { moduleRequireLogin } from "@erxes/api-utils/src/permissions";

import { getService, getServices } from "@erxes/api-utils/src/serviceDiscovery";
import { IActivityLogDocument } from "../../../db/models/definitions/activityLogs";
import { IContext } from "../../../connectionResolver";
import { fetchActivityLogs, fetchLogs } from "../../../db/utils/logUtils";
import { fetchServiceSegments, getContentIds } from "../../../messageBroker";

export interface IListArgs {
  contentType: string;
  contentId: string;
  activityType: string;
}

interface IListArgsByAction {
  contentType: string;
  action: string;
  pipelineId: string;
  perPage?: number;
  page?: number;
}

const activityLogQueries = {
  /**
   * Get activity log list
   */
  async activityLogs(_root, doc: IListArgs, { models, subdomain }: IContext) {
    return await Activities(subdomain,models, doc)
  },

  async activityLogsByAction(
    _root,
    {
      contentType,
      action,
      pipelineId,
      perPage = 10,
      page = 1
    }: IListArgsByAction,
    { models, subdomain }: IContext
  ) {
    const allActivityLogs: any[] = [];
    let allTotalCount: number = 0;

    if (!action) {
      return {
        activityLogs: [],
        totalCount: 0
      };
    }

    let actionArr = action.split(",");

    const perPageForAction = perPage / actionArr.length;

    const contentIds = await getContentIds(subdomain, {
      pipelineId,
      contentType
    });

    actionArr = actionArr.filter(a => a !== "delete");

    if (actionArr.length > 0) {
      const { activityLogs, totalCount } = await fetchActivityLogs(models, {
        contentType,
        contentId: { $in: contentIds },
        action: { $in: actionArr },
        perPage: perPageForAction * 3,
        page
      });

      for (const log of activityLogs) {
        allActivityLogs.push({
          _id: log._id,
          action: log.action,
          createdAt: log.createdAt,
          createdBy: log.createdBy,
          contentType: log.contentType,
          contentId: log.contentId,
          content: log.content
        });
      }

      allTotalCount += totalCount;
    }

    if (action.includes("delete")) {
      const { logs, totalCount } = await fetchLogs(models, {
        action: "delete",
        type: contentType,
        perPage: perPageForAction,
        page
      });

      for (const log of logs) {
        allActivityLogs.push({
          _id: log._id,
          action: log.action,
          contentType: log.type,
          contentId: log.objectId,
          createdAt: log.createdAt,
          createdBy: log.createdBy,
          content: log.description
        });
      }

      allTotalCount += totalCount;
    }

    return {
      activityLogs: allActivityLogs,
      totalCount: allTotalCount
    };
  }
};

moduleRequireLogin(activityLogQueries);

export default activityLogQueries;

export const Activities = async (subdomain,models, query) => {
    const { contentId, contentType, activityType } = query;
    const activities: any[] = [];

    if (activityType && activityType !== "activity") {
      const serviceName = activityType.split(":")[0];

      if (serviceName === "core") {
        const logType = activityType.split(":")[1];

        switch (logType) {
          case "internalNote":
            const notes = await models.InternalNotes.find({
              contentTypeId: contentId
            }).sort({ createdAt: -1 });

            for (const note of notes) {
              note.contentType = "core:internalNote";
            }

            return notes;

          default:
            break;
        }
      }

      const result = await fetchServiceSegments(
        subdomain,
        serviceName,
        "collectItems",
        { contentId, contentType, activityType },
        ""
      );

      const { data } = result;

      return data;
    }

    const services = await getServices();
    const activityLogs = await models.ActivityLogs.find({
      contentId
    }).lean();

    for (const serviceName of services) {
      const service = await getService(serviceName);
      const meta = service.config.meta || {};

      if (meta && meta.logs) {
        const logs = meta.logs;

        if (logs.providesActivityLog) {
          const result = await fetchServiceSegments(
            subdomain,
            serviceName,
            "collectItems",
            { contentId, contentType, activityLogs },
            ""
          );

          const { data } = result;

          if (Array.isArray(data) && data.length > 0) {
            activities.push(...data);
          }
        }
      }
    }

    const notes =
      (await models.InternalNotes.find({
        contentTypeId: contentId
      })
        .lean()
        .sort({ createdAt: -1 })) || [];

    for (const note of notes) {
      note.contentType = "core:internalNote";

      activities.push(note);
    }

    activities.push(...activityLogs);

    activities.sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return activities;
}