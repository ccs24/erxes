import {
  fetchByQuery,
  fetchByQueryWithScroll
} from "@erxes/api-utils/src/elasticsearch";
import { generateModels } from "./connectionResolver";
import { sendCommonMessage, sendCoreMessage } from "./messageBroker";
import { generateConditionStageIds } from "./utils";
import {
  gatherAssociatedTypes,
  getEsIndexByContentType,
  getName,
  getServiceName
} from "@erxes/api-utils/src/segments";

export default {
  dependentServices: [
    {
      name: "core",
      // types: ["company", "customer", "lead"],
      twoWay: true,
      associated: true
    },
    { name: "tickets", twoWay: true, associated: true },
    { name: "sales", twoWay: true, associated: true },
    { name: "purchases", twoWay: true, associated: true },
    { name: "inbox", twoWay: true }
  ],

  contentTypes: [
    {
      type: "task",
      description: "Task",
      esIndex: "tasks"
    }
  ],

  propertyConditionExtender: async ({ subdomain, data: { condition } }) => {
    const models = await generateModels(subdomain);

    let positive;
    let ignoreThisPostiveQuery;

    const stageIds = await generateConditionStageIds(models, {
      boardId: condition.boardId,
      pipelineId: condition.pipelineId
    });

    if (stageIds.length > 0) {
      positive = {
        terms: {
          stageId: stageIds
        }
      };
    }

    const productIds = await generateProductsCategoryProductIds(
      subdomain,
      condition
    );
    if (productIds.length > 0) {
      positive = {
        bool: {
          should: productIds.map(productId => ({
            match: { "productsData.productId": productId }
          }))
        }
      };

      if (condition.propertyName == "productsData.categoryId") {
        ignoreThisPostiveQuery = true;
      }
    }

    return { data: { positive, ignoreThisPostiveQuery }, status: "success" };
  },

  associationFilter: async ({
    subdomain,
    data: { mainType, propertyType, positiveQuery, negativeQuery }
  }) => {
    const associatedTypes: string[] = await gatherAssociatedTypes(mainType);

    let ids: string[] = [];

    if (associatedTypes.includes(propertyType)) {
      const mainTypeIds = await fetchByQueryWithScroll({
        subdomain,
        index: await getEsIndexByContentType(propertyType),
        positiveQuery,
        negativeQuery
      });

      ids = await sendCoreMessage({
        subdomain,
        action: "conformities.filterConformity",
        data: {
          mainType: getName(propertyType),
          mainTypeIds,
          relType: getName(mainType)
        },
        isRPC: true
      });
    } else {
      const serviceName = getServiceName(propertyType);

      if (serviceName === "tasks") {
        return { data: [], status: "error" };
      }

      ids = await sendCommonMessage({
        serviceName,
        subdomain,
        action: "segments.associationFilter",
        data: {
          mainType,
          propertyType,
          positiveQuery,
          negativeQuery
        },
        defaultValue: [],
        isRPC: true
      });
    }

    return { data: ids, status: "success" };
  },

  esTypesMap: async () => {
    return { data: { typesMap: {} }, status: "success" };
  },

  initialSelector: async ({ subdomain, data: { segment, options } }) => {
    const models = await generateModels(subdomain);

    let positive;

    const config = segment.config || {};

    const stageIds = await generateConditionStageIds(models, {
      boardId: config.boardId,
      pipelineId: config.pipelineId,
      options
    });

    if (stageIds.length > 0) {
      positive = { terms: { stageId: stageIds } };
    }

    return { data: { positive }, status: "success" };
  }
};

const generateProductsCategoryProductIds = async (subdomain, condition) => {
  let productCategoryIds: string[] = [];

  const { propertyName, propertyValue } = condition;
  if (propertyName === "productsData.categoryId") {
    productCategoryIds.push(propertyValue);

    const products = await sendCoreMessage({
      subdomain,
      action: "products.find",
      data: {
        categoryIds: [...new Set(productCategoryIds)],
        fields: { _id: 1 }
      },
      isRPC: true,
      defaultValue: []
    });

    const productIds = products.map(product => product._id);

    return productIds;
  }
  return [];
};
