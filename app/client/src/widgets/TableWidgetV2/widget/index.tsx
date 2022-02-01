import React, { lazy, Suspense } from "react";
import log from "loglevel";
import moment, { MomentInput } from "moment";
import _, {
  isNumber,
  isString,
  isNil,
  isEqual,
  xor,
  without,
  isBoolean,
  isArray,
  sortBy,
  xorWith,
  isEmpty,
} from "lodash";

import BaseWidget, { WidgetState } from "widgets/BaseWidget";
import { RenderModes, WidgetType } from "constants/WidgetConstants";
import { EventType } from "constants/AppsmithActionConstants/ActionConstants";
import {
  renderCell,
  renderDropdown,
  renderActions,
  renderMenuButton,
  RenderMenuButtonProps,
  renderIconButton,
} from "../component/TableUtilities";
import Skeleton from "components/utils/Skeleton";
import { noop, retryPromise } from "utils/AppsmithUtils";

import { getDynamicBindings } from "utils/DynamicBindingUtils";
import { ReactTableFilter, OperatorTypes } from "../component/Constants";
import {
  COLUMN_MIN_WIDTH,
  COLUMN_TYPES,
  DEFAULT_BUTTON_COLOR,
  DEFAULT_BUTTON_LABEL,
  DEFAULT_BUTTON_LABEL_COLOR,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_MENU_BUTTON_LABEL,
  DEFAULT_MENU_VARIANT,
  ORIGINAL_INDEX_KEY,
  TableWidgetProps,
} from "../constants";
import derivedProperties from "./parseDerivedProperties";
import {
  getAllTableColumnKeys,
  getDefaultColumnProperties,
  getDerivedColumns,
  getTableStyles,
  getSelectRowIndex,
  getSelectRowIndices,
} from "./utilities";

import {
  ColumnProperties,
  ReactTableColumnProps,
  ColumnTypes,
  CompactModeTypes,
  SortOrderTypes,
} from "../component/Constants";
import tablePropertyPaneConfig from "./propertyConfig";
import { BatchPropertyUpdatePayload } from "actions/controlActions";
import { IconName } from "@blueprintjs/icons";
import { getCellProperties } from "./getTableColumns";
import { Colors } from "constants/Colors";
import { IconNames } from "@blueprintjs/core/node_modules/@blueprintjs/icons";

const ReactTableComponent = lazy(() =>
  retryPromise(() => import("../component")),
);
const defaultFilter = [
  {
    column: "",
    operator: OperatorTypes.OR,
    value: "",
    condition: "",
  },
];

class TableWidget extends BaseWidget<TableWidgetProps, WidgetState> {
  static getPropertyPaneConfig() {
    return tablePropertyPaneConfig;
  }

  static getMetaPropertiesMap(): Record<string, any> {
    return {
      pageNo: 1,
      selectedRowIndex: undefined,
      selectedRowIndices: undefined,
      searchText: undefined,
      triggeredRowIndex: undefined,
      filters: [],
      sortOrder: {
        column: "",
        order: null,
      },
    };
  }

  static getDerivedPropertiesMap() {
    return {
      selectedRow: `{{(()=>{${derivedProperties.getSelectedRow}})()}}`,
      triggeredRow: `{{(()=>{${derivedProperties.getTriggeredRow}})()}}`,
      selectedRows: `{{(()=>{${derivedProperties.getSelectedRows}})()}}`,
      pageSize: `{{(()=>{${derivedProperties.getPageSize}})()}}`,
      triggerRowSelection: "{{!!this.onRowSelected}}",
      sanitizedTableData: `{{(()=>{${derivedProperties.getSanitizedTableData}})()}}`,
      tableColumns: `{{(()=>{${derivedProperties.getTableColumns}})()}}`,
      filteredTableData: `{{(()=>{ ${derivedProperties.getFilteredTableData}})()}}`,
    };
  }

  static getDefaultPropertiesMap(): Record<string, string> {
    return {
      searchText: "defaultSearchText",
      selectedRowIndex: "defaultSelectedRow",
      selectedRowIndices: "defaultSelectedRow",
    };
  }

  /*
   * Function to get the table columns with appropriate render functions
   * based on columnType
   */
  //TODO(Balaji): Move this to Utility and write test cases.
  getTableColumns = () => {
    const {
      columnWidthMap = {},
      filteredTableData = [],
      multiRowSelection,
      selectedRowIndex,
      selectedRowIndices,
      tableColumns = [],
    } = this.props;
    let columns: ReactTableColumnProps[] = [];
    const hiddenColumns: ReactTableColumnProps[] = [];

    const { componentWidth } = this.getComponentDimensions();
    let totalColumnWidth = 0;

    tableColumns.forEach((column) => {
      const isHidden = !column.isVisible;
      const accessor = column.id;
      const columnData = {
        Header: column.label,
        accessor: accessor,
        width: columnWidthMap[accessor] || DEFAULT_COLUMN_WIDTH,
        minWidth: COLUMN_MIN_WIDTH,
        draggable: true,
        isHidden: false,
        isAscOrder: column.isAscOrder,
        isDerived: column.isDerived,
        metaProperties: {
          isHidden: isHidden,
          type: column.columnType,
          format: column.outputFormat || "",
          inputFormat: column.inputFormat || "",
        },
        columnProperties: column,
        Cell: (props: any) => {
          const rowIndex: number = props.cell.row.index;
          const row = filteredTableData[rowIndex];
          const originalIndex = row[ORIGINAL_INDEX_KEY] ?? rowIndex;

          // cellProperties order or size does not change when filter/sorting/grouping is applied
          // on the data thus original index is needed to identify the column's cell property.
          const cellProperties = getCellProperties(column, originalIndex);
          let isSelected = false;

          if (multiRowSelection) {
            isSelected =
              _.isArray(selectedRowIndices) &&
              selectedRowIndices.includes(rowIndex);
          } else {
            isSelected = selectedRowIndex === rowIndex;
          }

          switch (column.columnType) {
            case COLUMN_TYPES.BUTTON:
              const buttonProps = {
                isSelected: isSelected,
                onCommandClick: (action: string, onComplete: () => void) =>
                  this.onCommandClick(rowIndex, action, onComplete),
                backgroundColor:
                  cellProperties.buttonColor || DEFAULT_BUTTON_COLOR,
                buttonLabelColor:
                  cellProperties.buttonLabelColor || DEFAULT_BUTTON_LABEL_COLOR,
                isDisabled: !!cellProperties.isDisabled,
                isCellVisible: cellProperties.isCellVisible ?? true,
                columnActions: [
                  {
                    id: column.id,
                    label: cellProperties.buttonLabel || DEFAULT_BUTTON_LABEL,
                    dynamicTrigger: column.onClick || "",
                  },
                ],
              };
              return renderActions(buttonProps, isHidden, cellProperties);

            case COLUMN_TYPES.DROPDOWN:
              let options = [];

              try {
                options = JSON.parse(column.dropdownOptions || "");
              } catch (e) {}

              return renderDropdown({
                options: options,
                onItemSelect: this.onDropdownOptionSelect,
                isCellVisible: cellProperties.isCellVisible ?? true,
                onOptionChange: column.onOptionChange || "",
                selectedIndex: isNumber(props.cell.value)
                  ? props.cell.value
                  : undefined,
              });

            case COLUMN_TYPES.IMAGE:
              const onClick = column.onClick
                ? () => this.onCommandClick(rowIndex, column.onClick, noop)
                : noop;

              return renderCell(
                props.cell.value,
                column.columnType,
                isHidden,
                cellProperties,
                componentWidth,
                cellProperties.isCellVisible ?? true,
                onClick,
                isSelected,
              );

            case COLUMN_TYPES.MENUBUTTON:
              const menuButtonProps: RenderMenuButtonProps = {
                isSelected: isSelected,
                onCommandClick: (action: string, onComplete?: () => void) =>
                  this.onCommandClick(rowIndex, action, onComplete),
                isDisabled: !!cellProperties.isDisabled,
                menuItems: cellProperties.menuItems,
                isCompact: !!cellProperties.isCompact,
                menuVariant: cellProperties.menuVariant ?? DEFAULT_MENU_VARIANT,
                menuColor: cellProperties.menuColor || Colors.GREEN,
                borderRadius: cellProperties.borderRadius,
                boxShadow: cellProperties.boxShadow,
                boxShadowColor: cellProperties.boxShadowColor,
                iconName: cellProperties.iconName,
                iconAlign: cellProperties.iconAlign,
                isCellVisible: cellProperties.isCellVisible ?? true,
                label:
                  cellProperties.menuButtonLabel ?? DEFAULT_MENU_BUTTON_LABEL,
              };

              return renderMenuButton(
                menuButtonProps,
                isHidden,
                cellProperties,
              );

            case COLUMN_TYPES.ICONBUTTON:
              const iconButtonProps = {
                isSelected: isSelected,
                onCommandClick: (action: string, onComplete: () => void) =>
                  this.onCommandClick(rowIndex, action, onComplete),
                columnActions: [
                  {
                    id: column.id,
                    dynamicTrigger: column.onClick || "",
                  },
                ],
                iconName: (cellProperties.iconName ||
                  IconNames.ADD) as IconName,
                buttonColor: cellProperties.buttonColor || Colors.GREEN,
                buttonVariant: cellProperties.buttonVariant || "PRIMARY",
                borderRadius: cellProperties.borderRadius || "SHARP",
                boxShadow: cellProperties.boxShadow || "NONE",
                boxShadowColor: cellProperties.boxShadowColor || "",
                isCellVisible: cellProperties.isCellVisible ?? true,
                disabled: !!cellProperties.isDisabled,
              };

              return renderIconButton(
                iconButtonProps,
                isHidden,
                cellProperties,
              );

            default:
              return renderCell(
                props.cell.value,
                column.columnType,
                isHidden,
                cellProperties,
                componentWidth,
                cellProperties.isCellVisible ?? true,
              );
          }
        },
      };

      const isAllCellVisible: boolean | boolean[] = column.isCellVisible;

      /*
       * If all cells are not visible or column itself is not visible,
       * set isHidden and push it to hiddenColumns array else columns array
       */
      if (
        (isBoolean(isAllCellVisible) && !isAllCellVisible) ||
        (isArray(isAllCellVisible) &&
          isAllCellVisible.every((visibility) => visibility === false)) ||
        isHidden
      ) {
        columnData.isHidden = true;
        hiddenColumns.push(columnData);
      } else {
        totalColumnWidth += columnData.width;
        columns.push(columnData);
      }
    });

    if (totalColumnWidth < componentWidth) {
      const lastColumnIndex = columns.length - 1;

      if (columns[lastColumnIndex]) {
        const remainingWidth = componentWidth - totalColumnWidth;
        columns[lastColumnIndex].width =
          remainingWidth < DEFAULT_COLUMN_WIDTH
            ? DEFAULT_COLUMN_WIDTH
            : remainingWidth;
      }
    }

    if (hiddenColumns.length && this.props.renderMode === RenderModes.CANVAS) {
      columns = columns.concat(hiddenColumns);
    }

    return columns.filter((column: ReactTableColumnProps) => !!column.accessor);
  };

  //TODO(Balaji): Move this to utilities and write test cases
  transformData = (
    tableData: Array<Record<string, unknown>>,
    columns: ReactTableColumnProps[],
  ) => {
    return tableData.map((row, rowIndex) => {
      const newRow: { [key: string]: any } = {};

      columns.forEach((column) => {
        const { accessor } = column;
        let value = row[accessor];

        if (column.metaProperties) {
          switch (column.metaProperties.type) {
            case ColumnTypes.DATE:
              let isValidDate = true;
              let outputFormat = _.isArray(column.metaProperties.format)
                ? column.metaProperties.format[rowIndex]
                : column.metaProperties.format;
              let inputFormat;

              try {
                const type = _.isArray(column.metaProperties.inputFormat)
                  ? column.metaProperties.inputFormat[rowIndex]
                  : column.metaProperties.inputFormat;

                if (type !== "Epoch" && type !== "Milliseconds") {
                  inputFormat = type;
                  moment(value as MomentInput, inputFormat);
                } else if (!isNumber(value)) {
                  isValidDate = false;
                }
              } catch (e) {
                isValidDate = false;
              }

              if (isValidDate && value) {
                try {
                  if (outputFormat === "SAME_AS_INPUT") {
                    outputFormat = inputFormat;
                  }

                  if (column.metaProperties.inputFormat === "Milliseconds") {
                    value = Number(value);
                  } else if (column.metaProperties.inputFormat === "Epoch") {
                    value = 1000 * Number(value);
                  }

                  newRow[accessor] = moment(
                    value as MomentInput,
                    inputFormat,
                  ).format(outputFormat);
                } catch (e) {
                  log.debug("Unable to parse Date:", { e });
                  newRow[accessor] = "";
                }
              } else if (value) {
                newRow[accessor] = "Invalid Value";
              } else {
                newRow[accessor] = "";
              }
              break;
            default:
              let data;

              if (_.isString(value) || _.isNumber(value)) {
                data = value;
              } else if (isNil(value)) {
                data = "";
              } else {
                data = JSON.stringify(value);
              }

              newRow[accessor] = data;
              break;
          }
        }
      });

      return newRow;
    });
  };

  //TODO(Balaji): Move this to utilities and write test cases
  getParsedComputedValues = (value: string | Array<unknown>) => {
    let computedValues: Array<unknown> = [];

    if (_.isString(value)) {
      try {
        computedValues = JSON.parse(value);
      } catch (e) {
        log.debug("Error parsing column value: ", value);
      }
    } else if (_.isArray(value)) {
      computedValues = value;
    } else {
      log.debug("Error parsing column values:", value);
    }

    return computedValues;
  };

  updateDerivedColumnsIndex = (
    derivedColumns: Record<string, ColumnProperties>,
    tableColumnCount: number,
  ) => {
    if (!derivedColumns) {
      return [];
    }

    //update index property of all columns in new derived columns
    return Object.values(derivedColumns).map(
      (column: ColumnProperties, index: number) => {
        return {
          ...column,
          index: index + tableColumnCount,
        };
      },
    );
  };

  /*
   * Function to create new primary Columns from the sanitizedTableData
   * gets called on component mount and on component update
   */
  //TODO(Balaji): Move this to utilities and write test cases
  createTablePrimaryColumns = ():
    | Record<string, ColumnProperties>
    | undefined => {
    const { sanitizedTableData = [], primaryColumns = {} } = this.props;

    if (!_.isArray(sanitizedTableData) || sanitizedTableData.length === 0) {
      return;
    }

    const existingColumnIds = Object.keys(primaryColumns);
    const newTableColumns: Record<string, ColumnProperties> = {};
    const tableStyles = getTableStyles(this.props);
    const columnKeys: string[] = getAllTableColumnKeys(sanitizedTableData);

    /*
     * Generate default column properties for all columns
     * But do not replace existing columns with the same id
     */
    columnKeys.forEach((columnKey, index) => {
      const prevIndex = existingColumnIds.indexOf(columnKey);

      if (prevIndex > -1) {
        // Use the existing column properties
        newTableColumns[columnKey] = primaryColumns[columnKey];
      } else {
        // Create column properties for the new column
        const columnProperties = getDefaultColumnProperties(
          columnKey,
          index,
          this.props.widgetName,
        );

        newTableColumns[columnProperties.id] = {
          ...columnProperties,
          ...tableStyles,
        };
      }
    });

    const derivedColumns: Record<string, ColumnProperties> = getDerivedColumns(
      primaryColumns,
    );

    const updatedDerivedColumns = this.updateDerivedColumnsIndex(
      derivedColumns,
      Object.keys(newTableColumns).length,
    );

    //add derived columns to new Table columns
    updatedDerivedColumns.forEach((derivedColumn: ColumnProperties) => {
      newTableColumns[derivedColumn.id] = derivedColumn;
    });

    const newColumnIds = Object.keys(newTableColumns);

    // check if the columns ids differ
    if (_.xor(existingColumnIds, newColumnIds).length > 0) {
      return newTableColumns;
    } else {
      return;
    }
  };

  updateColumnProperties = (
    tableColumns?: Record<string, ColumnProperties>,
  ) => {
    const { columnOrder = [], primaryColumns = {} } = this.props;
    const derivedColumns = getDerivedColumns(primaryColumns);

    if (tableColumns) {
      const existingColumnIds = Object.keys(primaryColumns);
      const existingDerivedColumnIds = Object.keys(derivedColumns);

      const newColumnIds = Object.keys(tableColumns);

      //Check if there is any difference in the existing and new columns ids
      if (_.xor(existingColumnIds, newColumnIds).length > 0) {
        const newColumnIdsToAdd = _.without(newColumnIds, ...existingColumnIds);

        const propertiesToAdd: Record<string, unknown> = {};

        newColumnIdsToAdd.forEach((columnId: string) => {
          // id could be an empty string
          if (!!columnId) {
            Object.entries(tableColumns[columnId]).forEach(([key, value]) => {
              propertiesToAdd[`primaryColumns.${columnId}.${key}`] = value;
            });
          }
        });

        /*
         * If new columnOrders have different values from the original columnOrders
         * Only update when there are new Columns(Derived or Primary)
         */
        if (
          newColumnIds.length > 0 &&
          _.xor(newColumnIds, columnOrder).length > 0 &&
          !_.isEqual(_.sortBy(newColumnIds), _.sortBy(existingDerivedColumnIds))
        ) {
          propertiesToAdd["columnOrder"] = newColumnIds;
        }

        const pathsToDelete: string[] = [];
        const propertiesToUpdate: BatchPropertyUpdatePayload = {
          modify: propertiesToAdd,
        };
        const columnsIdsToDelete = without(existingColumnIds, ...newColumnIds);

        if (columnsIdsToDelete.length > 0) {
          columnsIdsToDelete.forEach((id: string) => {
            if (!primaryColumns[id].isDerived) {
              pathsToDelete.push(`primaryColumns.${id}`);
            }
          });
          propertiesToUpdate.remove = pathsToDelete;
        }

        super.batchUpdateWidgetProperty(propertiesToUpdate, false);
      }
    }
  };

  componentDidMount() {
    const { sanitizedTableData } = this.props;

    if (_.isArray(sanitizedTableData) && sanitizedTableData.length > 0) {
      const newPrimaryColumns = this.createTablePrimaryColumns();

      // When the Table data schema changes
      if (newPrimaryColumns) {
        this.updateColumnProperties(newPrimaryColumns);
      }
    }
  }

  componentDidUpdate(prevProps: TableWidgetProps) {
    const { primaryColumns = {} } = this.props;

    // Bail out if santizedTableData is a string. This signifies an error in evaluations
    if (isString(this.props.sanitizedTableData)) {
      return;
    }

    // Check if tableData is modifed
    const isTableDataModified =
      JSON.stringify(this.props.sanitizedTableData) !==
      JSON.stringify(prevProps.sanitizedTableData);

    if (isTableDataModified) {
      //update
      this.updateMetaRowData(
        prevProps.filteredTableData,
        this.props.filteredTableData,
      );
      this.props.updateWidgetMetaProperty("triggeredRowIndex", undefined);
    }

    // If the user has changed the tableData OR
    // The binding has returned a new value
    if (tableDataModified) {
      // Set filter to default
      const defaultFilter = [
        {
          column: "",
          operator: OperatorTypes.OR,
          value: "",
          condition: "",
        },
      ];
      this.props.updateWidgetMetaProperty("filters", defaultFilter);
      // Get columns keys from this.props.tableData
      const columnIds: string[] = getAllTableColumnKeys(this.props.tableData);
      // Get column keys from columns except for derivedColumns
      const primaryColumnIds = Object.keys(primaryColumns).filter(
        (id: string) => {
          return !primaryColumns[id].isDerived; // Filter out the derived columns
        },
      );

      // If the keys which exist in the tableData are different from the ones available in primaryColumns
      if (xor(columnIds, primaryColumnIds).length > 0) {
        const newTableColumns = this.createTablePrimaryColumns(); // This updates the widget
        this.updateColumnProperties(newTableColumns);
      }
    }

    if (!this.props.pageNo) this.props.updateWidgetMetaProperty("pageNo", 1);

    //handle selected pageNo does not exist due to change of totalRecordsCount
    if (
      this.props.serverSidePaginationEnabled &&
      this.props.totalRecordsCount
    ) {
      const maxAllowedPageNumber = Math.ceil(
        this.props.totalRecordsCount / this.props.pageSize,
      );
      if (this.props.pageNo > maxAllowedPageNumber) {
        this.props.updateWidgetMetaProperty("pageNo", maxAllowedPageNumber);
      }
    } else if (
      this.props.serverSidePaginationEnabled !==
      prevProps.serverSidePaginationEnabled
    ) {
      //reset pageNo when serverSidePaginationEnabled is toggled
      this.props.updateWidgetMetaProperty("pageNo", 1);
    }

    // If the user has switched the mutiple row selection feature
    if (this.props.multiRowSelection !== prevProps.multiRowSelection) {
      // It is switched ON:
      if (this.props.multiRowSelection) {
        // Use the selectedRowIndex if available as default selected index
        let selectedRowIndices: number[] = [];
        // Check if selectedRowIndex is valid
        if (
          this.props.selectedRowIndex !== undefined &&
          this.props.selectedRowIndex > -1 &&
          !Array.isArray(this.props.selectedRowIndex)
        ) {
          selectedRowIndices = [this.props.selectedRowIndex];
        }
        // Else use the defaultSelectedRow if available
        else if (
          isNumber(this.props.defaultSelectedRow) ||
          Array.isArray(this.props.defaultSelectedRow)
        ) {
          selectedRowIndices = isNumber(this.props.defaultSelectedRow)
            ? [this.props.defaultSelectedRow]
            : this.props.defaultSelectedRow;
        }

        this.props.updateWidgetMetaProperty(
          "selectedRowIndices",
          selectedRowIndices,
        );
        this.props.updateWidgetMetaProperty("selectedRowIndex", -1);
      } else {
        this.props.updateWidgetMetaProperty("selectedRowIndices", []);
      }
    }

    // If the user changed the defaultSelectedRow(s)
    if (!isEqual(this.props.defaultSelectedRow, prevProps.defaultSelectedRow)) {
      //Runs only when defaultSelectedRow is changed from property pane
      this.updateSelectedRowIndex();
    }

    if (this.props.pageSize !== prevProps.pageSize) {
      //reset current page number when page size changes
      this.props.updateWidgetMetaProperty("pageNo", 1);
      if (this.props.onPageSizeChange) {
        super.executeAction({
          triggerPropertyName: "onPageSizeChange",
          dynamicString: this.props.onPageSizeChange,
          event: {
            type: EventType.ON_PAGE_SIZE_CHANGE,
          },
        });
      }
    }
  }

  updateSelectedRowIndex = () => {
    if (!this.props.multiRowSelection) {
      const selectedRowIndex = isNumber(this.props.defaultSelectedRow)
        ? this.props.defaultSelectedRow
        : -1;
      this.props.updateWidgetMetaProperty("selectedRowIndex", selectedRowIndex);
    } else {
      const selectedRowIndices = Array.isArray(this.props.defaultSelectedRow)
        ? this.props.defaultSelectedRow
        : [];
      this.props.updateWidgetMetaProperty(
        "selectedRowIndices",
        selectedRowIndices,
      );
    }
  };

  updateMetaRowData = (
    oldTableData: Array<Record<string, unknown>>,
    newTableData: Array<Record<string, unknown>>,
  ) => {
    if (!this.props.multiRowSelection) {
      const selectedRowIndex = getSelectRowIndex(
        oldTableData,
        newTableData,
        this.props.defaultSelectedRow,
        this.props.selectedRowIndex,
        this.props.primaryColumnId,
      );
      this.props.updateWidgetMetaProperty("selectedRowIndex", selectedRowIndex);
    } else {
      const selectedRowIndices = getSelectRowIndices(
        oldTableData,
        newTableData,
        this.props.defaultSelectedRow,
        this.props.selectedRowIndices,
        this.props.primaryColumnId,
      );
      this.props.updateWidgetMetaProperty(
        "selectedRowIndices",
        selectedRowIndices,
      );
    }
  };

  getSelectedRowIndices = () => {
    let selectedRowIndices: number[] | undefined = this.props
      .selectedRowIndices;
    if (!this.props.multiRowSelection) selectedRowIndices = undefined;
    else {
      if (!Array.isArray(selectedRowIndices)) {
        if (Number.isInteger(selectedRowIndices))
          selectedRowIndices = [selectedRowIndices];
        else selectedRowIndices = [];
      }
    }
    return selectedRowIndices;
  };

  applyFilters = (filters: ReactTableFilter[]) => {
    this.resetSelectedRowIndex();
    this.props.updateWidgetMetaProperty("filters", filters);

    // Reset Page only when a filter is added
    if (!isEmpty(xorWith(filters, defaultFilter, isEqual))) {
      this.props.updateWidgetMetaProperty("pageNo", 1);
    }
  };

  toggleDrag = (disable: boolean) => {
    this.disableDrag(disable);
  };

  getPageView() {
    const {
      totalRecordsCount,
      delimiter,
      pageSize,
      filteredTableData = [],
      isVisibleDownload,
      isVisibleFilters,
      isVisiblePagination,
      isVisibleSearch,
    } = this.props;
    const tableColumns = this.getTableColumns() || [];
    const transformedData = this.transformData(filteredTableData, tableColumns);
    const isVisibleHeaderOptions =
      isVisibleDownload ||
      isVisibleFilters ||
      isVisiblePagination ||
      isVisibleSearch;

    const { componentHeight, componentWidth } = this.getComponentDimensions();

    return (
      <Suspense fallback={<Skeleton />}>
        <ReactTableComponent
          applyFilter={this.applyFilters}
          columnWidthMap={this.props.columnWidthMap}
          columns={tableColumns}
          compactMode={this.props.compactMode || CompactModeTypes.DEFAULT}
          delimiter={delimiter}
          disableDrag={this.toggleDrag}
          editMode={this.props.renderMode === RenderModes.CANVAS}
          filters={this.props.filters}
          handleReorderColumn={this.handleReorderColumn}
          handleResizeColumn={this.handleResizeColumn}
          height={componentHeight}
          isLoading={this.props.isLoading}
          isSortable={this.props.isSortable ?? true}
          isVisibleDownload={isVisibleDownload}
          isVisibleFilters={isVisibleFilters}
          isVisiblePagination={isVisiblePagination}
          isVisibleSearch={isVisibleSearch}
          multiRowSelection={this.props.multiRowSelection}
          nextPageClick={this.handleNextPageClick}
          onCommandClick={this.onCommandClick}
          onRowClick={this.handleRowClick}
          pageNo={this.props.pageNo}
          pageSize={
            isVisibleHeaderOptions ? Math.max(1, pageSize) : pageSize + 1
          }
          prevPageClick={this.handlePrevPageClick}
          searchKey={this.props.searchText}
          searchTableData={this.handleSearchTable}
          selectAllRow={this.handleAllRowSelect}
          selectedRowIndex={
            this.props.selectedRowIndex === undefined
              ? -1
              : this.props.selectedRowIndex
          }
          selectedRowIndices={this.getSelectedRowIndices()}
          serverSidePaginationEnabled={!!this.props.serverSidePaginationEnabled}
          sortTableColumn={this.handleColumnSorting}
          tableData={transformedData}
          totalRecordsCount={totalRecordsCount}
          triggerRowSelection={this.props.triggerRowSelection}
          unSelectAllRow={this.resetSelectedRowIndex}
          updatePageNo={this.updatePageNumber}
          widgetId={this.props.widgetId}
          widgetName={this.props.widgetName}
          width={componentWidth}
        />
      </Suspense>
    );
  }

  handleReorderColumn = (columnOrder: string[]) => {
    if (this.props.renderMode === RenderModes.CANVAS) {
      super.updateWidgetProperty("columnOrder", columnOrder);
    } else this.props.updateWidgetMetaProperty("columnOrder", columnOrder);
  };

  handleColumnSorting = (column: string, asc: boolean) => {
    this.resetSelectedRowIndex();
    const sortOrderProps =
      column === ""
        ? {
            column: "",
            order: null,
          }
        : {
            column: column,
            order: asc ? SortOrderTypes.asc : SortOrderTypes.desc,
          };
    this.props.updateWidgetMetaProperty("sortOrder", sortOrderProps, {
      triggerPropertyName: "onSort",
      dynamicString: this.props.onSort,
      event: {
        type: EventType.ON_SORT,
      },
    });
  };

  handleResizeColumn = (columnWidthMap: { [key: string]: number }) => {
    if (this.props.renderMode === RenderModes.CANVAS) {
      super.updateWidgetProperty("columnWidthMap", columnWidthMap);
    } else {
      this.props.updateWidgetMetaProperty("columnWidthMap", columnWidthMap);
    }
  };

  handleSearchTable = (searchKey: any) => {
    const { onSearchTextChanged } = this.props;
    this.resetSelectedRowIndex();
    this.props.updateWidgetMetaProperty("pageNo", 1);
    this.props.updateWidgetMetaProperty("searchText", searchKey, {
      triggerPropertyName: "onSearchTextChanged",
      dynamicString: onSearchTextChanged,
      event: {
        type: EventType.ON_SEARCH,
      },
    });
  };

  onCommandClick = (
    rowIndex: number,
    action: string,
    onComplete?: () => void,
  ) => {
    try {
      const rowData = [this.props.filteredTableData[rowIndex]];
      this.props.updateWidgetMetaProperty(
        "triggeredRowIndex",
        this.props.filteredTableData[rowIndex].__originalIndex__,
      );
      const { jsSnippets } = getDynamicBindings(action);
      const modifiedAction = jsSnippets.reduce((prev: string, next: string) => {
        return prev + `{{(currentRow) => { ${next} }}} `;
      }, "");
      if (modifiedAction) {
        super.executeAction({
          triggerPropertyName: "onClick",
          dynamicString: modifiedAction,
          event: {
            type: EventType.ON_CLICK,
            callback: onComplete,
          },
          responseData: rowData,
        });
      } else {
        onComplete?.();
      }
    } catch (error) {
      log.debug("Error parsing row action", error);
    }
  };

  onDropdownOptionSelect = (action: string) => {
    super.executeAction({
      dynamicString: action,
      event: {
        type: EventType.ON_OPTION_CHANGE,
      },
    });
  };

  handleAllRowSelect = (pageData: Record<string, unknown>[]) => {
    if (this.props.multiRowSelection) {
      const selectedRowIndices = pageData.map(
        (row: Record<string, unknown>) => row.index,
      );
      this.props.updateWidgetMetaProperty(
        "selectedRowIndices",
        selectedRowIndices,
      );
    }
  };

  handleRowClick = (rowData: Record<string, unknown>, index: number) => {
    if (this.props.multiRowSelection) {
      const selectedRowIndices = Array.isArray(this.props.selectedRowIndices)
        ? [...this.props.selectedRowIndices]
        : [];
      if (selectedRowIndices.includes(index)) {
        const rowIndex = selectedRowIndices.indexOf(index);
        selectedRowIndices.splice(rowIndex, 1);
        this.props.updateWidgetMetaProperty(
          "selectedRowIndices",
          selectedRowIndices,
        );
      } else {
        selectedRowIndices.push(index);
        //trigger onRowSelected  on row selection
        this.props.updateWidgetMetaProperty(
          "selectedRowIndices",
          selectedRowIndices,
          {
            triggerPropertyName: "onRowSelected",
            dynamicString: this.props.onRowSelected,
            event: {
              type: EventType.ON_ROW_SELECTED,
            },
          },
        );
      }
    } else {
      const selectedRowIndex = isNumber(this.props.selectedRowIndex)
        ? this.props.selectedRowIndex
        : -1;

      if (selectedRowIndex !== index) {
        this.props.updateWidgetMetaProperty("selectedRowIndex", index, {
          triggerPropertyName: "onRowSelected",
          dynamicString: this.props.onRowSelected,
          event: {
            type: EventType.ON_ROW_SELECTED,
          },
        });
      } else {
        //reset selected row
        this.props.updateWidgetMetaProperty("selectedRowIndex", -1);
      }
    }
  };

  updatePageNumber = (pageNo: number, event?: EventType) => {
    if (event) {
      this.props.updateWidgetMetaProperty("pageNo", pageNo, {
        triggerPropertyName: "onPageChange",
        dynamicString: this.props.onPageChange,
        event: {
          type: event,
        },
      });
    } else {
      this.props.updateWidgetMetaProperty("pageNo", pageNo);
    }
    if (this.props.onPageChange) {
      this.resetSelectedRowIndex();
    }
  };

  handleNextPageClick = () => {
    let pageNo = this.props.pageNo || 1;
    pageNo = pageNo + 1;
    this.props.updateWidgetMetaProperty("pageNo", pageNo, {
      triggerPropertyName: "onPageChange",
      dynamicString: this.props.onPageChange,
      event: {
        type: EventType.ON_NEXT_PAGE,
      },
    });
    if (this.props.onPageChange) {
      this.resetSelectedRowIndex();
    }
  };

  resetSelectedRowIndex = () => {
    if (!this.props.multiRowSelection) {
      const selectedRowIndex = isNumber(this.props.defaultSelectedRow)
        ? this.props.defaultSelectedRow
        : -1;
      this.props.updateWidgetMetaProperty("selectedRowIndex", selectedRowIndex);
    } else {
      const selectedRowIndices = Array.isArray(this.props.defaultSelectedRow)
        ? this.props.defaultSelectedRow
        : [];
      this.props.updateWidgetMetaProperty(
        "selectedRowIndices",
        selectedRowIndices,
      );
    }
  };

  handlePrevPageClick = () => {
    let pageNo = this.props.pageNo || 1;
    pageNo = pageNo - 1;
    if (pageNo >= 1) {
      this.props.updateWidgetMetaProperty("pageNo", pageNo, {
        triggerPropertyName: "onPageChange",
        dynamicString: this.props.onPageChange,
        event: {
          type: EventType.ON_PREV_PAGE,
        },
      });
      if (this.props.onPageChange) {
        this.resetSelectedRowIndex();
      }
    }
  };

  static getWidgetType(): WidgetType {
    return "TABLE_WIDGET";
  }
}

export default TableWidget;
