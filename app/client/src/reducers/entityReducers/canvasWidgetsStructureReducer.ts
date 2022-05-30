import { createImmerReducer } from "utils/AppsmithUtils";
import {
  ReduxActionTypes,
  UpdateCanvasPayload,
  ReduxAction,
} from "@appsmith/constants/ReduxActionConstants";
import { WidgetProps } from "widgets/BaseWidget";
import { CanvasWidgetStructure } from "widgets/constants";
import { klona } from "klona";
import { pick } from "lodash";
import { WIDGET_STATIC_PROPS } from "constants/WidgetConstants";

const initialState: CanvasWidgetsReduxState = {};

function denormalize(
  rootWidgetId: string,
  widgets: Record<string, FlattenedWidgetProps>,
): CanvasWidgetStructure {
  const rootWidget = widgets[rootWidgetId];

  const children = (rootWidget.children || []).map((childId) =>
    denormalize(childId, widgets),
  );

  const structure = pick(rootWidget, Object.keys(WIDGET_STATIC_PROPS));
  const { type, widgetId, widgetName } = rootWidget;

  // eslint-disable-next-line
  // @ts-ignore
  return { type, widgetId, widgetName, children };
}

export type FlattenedWidgetProps<orType = never> =
  | (WidgetProps & {
      children?: string[];
    })
  | orType;

export interface CanvasWidgetsReduxState {
  [widgetId: string]: FlattenedWidgetProps;
}

const canvasWidgetsStructureReducer = createImmerReducer(initialState, {
  [ReduxActionTypes.INIT_CANVAS_LAYOUT]: (
    state: CanvasWidgetsReduxState,
    action: ReduxAction<UpdateCanvasPayload>,
  ) => {
    // return action.payload.widgets;
    return denormalize("0", klona(action.payload.widgets));
  },
  [ReduxActionTypes.UPDATE_LAYOUT]: (
    state: CanvasWidgetsReduxState,
    action: ReduxAction<UpdateCanvasPayload>,
  ) => {
    // return action.payload.widgets;
    return denormalize("0", klona(action.payload.widgets));
  },
});

export default canvasWidgetsStructureReducer;