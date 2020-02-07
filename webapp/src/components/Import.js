/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import React from 'react'
import IllustratedMessage from '@react/react-spectrum/IllustratedMessage'
import DropZone from '@react/react-spectrum/DropZone'
import Alert from '@react/react-spectrum/Alert'
import Dialog from '@react/react-spectrum/Dialog'
import Well from '@react/react-spectrum/Well'
import Button from '@react/react-spectrum/Button'
import Wait from '@react/react-spectrum/Wait';
import { TableView } from '@react/react-spectrum/TableView';
import ListDataSource from '@react/react-spectrum/ListDataSource'
import { IndexPath, IndexPathSet } from '@react/collection-view'
import csvParse from 'csv-parse/lib/sync';

import api from '../api';
import ModalTrigger from '@react/react-spectrum/ModalTrigger';
import PathBrowser from './PathBrowser';
//
class DataSource extends ListDataSource {
  constructor(...args) {
    super(...args);
    this.data = [];
  }

  setData(value) {
    this.data = value;
    this.reloadData();
  }

  async load() {
    return this.data;
  }
}

export default class Import extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      table: [],
      tableColumns: [],
      tableLoading: false,
      alertText: '',
      isVerified: false,
      selectedIndexPaths: new IndexPathSet(),
    };

    this.ds = new DataSource([[]]);
  }

  resetError() {
    this.setState({
      alertText: '',
    })
  }

  resetTable() {
    this.ds.setData([]);
    this.setState({
      table: [],
      tableColumns: [],
      isVerified: false,
      tableLoading: false,
      selectedIndexPaths: new IndexPathSet(),
    })
  }

  handleSelectionChange(selection) {
    this.setState({
      selectedIndexPaths: selection
    });
  }

  async verifyTable() {
    const tokenResponse = await this.props.app.props.acquireToken({
      scopes: ['files.read'],
    });
    if (!tokenResponse) {
      return;
    }
    try {
      this.setState({
        tableLoading: true,
      });
      const ret = await fetch(`${api.base}/api/verify`, {
        method: 'POST',
        body: JSON.stringify(this.state.table),
        headers: {
          'content-type': 'application/json',
          'x-ms-access-token': tokenResponse.accessToken,
          // Authorization: `Bearer ${tokenResponse.accessToken}`,
        },
      });
      const table = await ret.json();
      this.ds.setData(table);
      this.setState({
        table,
      });

      // select modified rows
      const indexPathSet = new IndexPathSet();
      table.forEach((row, idx) => {
        const modified = Object.keys(row).find((key) => {
          const ori = `${key}_original`;
          return ori in row && row[ori] !== row[key];
        });
        if (modified) {
          indexPathSet.addIndexPath(new IndexPath(0, idx));
        }
      });

      setTimeout(() => {
        this.setState({
          selectedIndexPaths: indexPathSet
        });
      }, 1);

    } finally {
      this.setState({
        tableLoading: false,
      })
    }

    this.setState({
      isVerified: true,
    })
  }

  uploadTable() {

  }

  handleDropCSV(evt) {
    if (evt.dataTransfer.files.length > 0) {
      const file = evt.dataTransfer.files[0];
      if (file.type !== 'text/csv') {
        this.setState({
          alertText: `Only CSV files supported. You provided ${file.type}`,
        });
        return;
      }
      console.log(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const table = csvParse(reader.result, {
          columns: true,
          skip_empty_lines: true,
        });
        table.sort((r0, r1) => r0.path.localeCompare(r1.path));
        this.ds.setData(table);
        console.log(table);

        const tableColumns = [];
        Object.keys(table[0]).forEach((key) => {
          tableColumns.push({
            key,
            title: key,
          });
        });

        this.setState({
          table,
          tableColumns,
        })
      };
      reader.readAsText(file);
    }
  }

  render() {
    const illustration = (
      <svg viewBox="0 0 199 97.7" height="50">
        <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeMiterlimit="10" strokeWidth="3px">
          <path d="M110.53,85.66,100.26,95.89a1.09,1.09,0,0,1-1.52,0L88.47,85.66" />
          <line x1="99.5" y1="95.5" x2="99.5" y2="58.5" />
          <path d="M105.5,73.5h19a2,2,0,0,0,2-2v-43" />
          <path d="M126.5,22.5h-19a2,2,0,0,1-2-2V1.5h-31a2,2,0,0,0-2,2v68a2,2,0,0,0,2,2h19" />
          <line x1="105.5" y1="1.5" x2="126.5" y2="22.5" />
          <path d="M139.5,36.5H196A1.49,1.49,0,0,1,197.5,38V72A1.49,1.49,0,0,1,196,73.5H141A1.49,1.49,0,0,1,139.5,72V32A1.49,1.49,0,0,1,141,30.5H154a2.43,2.43,0,0,1,1.67.66l6,5.66" />
          <rect x="1.5" y="34.5" width="58" height="39" rx="2" ry="2" />
          <path strokeWidth="2px" d="M47.93,50.49a5,5,0,1,0-4.83-5A4.93,4.93,0,0,0,47.93,50.49Z" />
          <path strokeWidth="2px" d="M36.6,65.93,42.05,60A2.06,2.06,0,0,1,45,60l12.68,13.2" />
          <path strokeWidth="2px" d="M3.14,73.23,22.42,53.76a1.65,1.65,0,0,1,2.38,0l19.05,19.7" />
        </g>
      </svg>
    );

    function renderCell(column, data) {
      const value = data[column.key];
      const keyOri = `${column.key}_original`;
      const valueOri = data[keyOri] || '';
      if (keyOri in data && valueOri !== value) {
        const valueOri = data[keyOri];
        const oldValue = valueOri ? <del>{valueOri}</del> : '';
        const newValue = value ? <ins>{value}</ins> : '';
        const sep = value && valueOri ? <br/> : '';
        return <span className="import-table-item">{oldValue}{sep}{newValue}</span>;
      } else {
        return <span className="import-table-item">{value}</span>;
      }
    }

    return (
      <>
        <div style={{textAlign: 'center'}}>
          {this.state.alertText &&
          <Alert header="Error" onClose={this.resetError.bind(this)} closeLabel="Close" variant="error">
            {this.state.alertText}
          </Alert>
          }
          {this.state.table.length === 0 &&
            <DropZone onDrop={this.handleDropCSV.bind(this)}>
              <IllustratedMessage
                heading="Drag and Drop Your CSV here."
                illustration={illustration} />
            </DropZone>
          }
          {this.state.table.length > 0 &&
            <>
              <Well>
                <Button onClick={this.resetTable.bind(this)}>Reset</Button>
                <Button onClick={this.verifyTable.bind(this)}>Verify</Button>

                <ModalTrigger>
                  <Button disabled={!this.state.isVerified}>Update Documents</Button>
                  <Dialog
                    title="Upload Changes"
                    variant="confirmation"
                    confirmLabel="OK"
                    cancelLabel="Cancel"
                    onConfirm={this.uploadTable.bind(this)}
                  >
                    Are you sure you want to apply those changes?
                  </Dialog>
                </ModalTrigger>

              </Well>
              <div className="csv-preview">
                {this.state.tableLoading && <Wait />}
                <TableView
                  className="import-table"
                  dataSource={this.ds}
                  columns={this.state.tableColumns}
                  renderCell={renderCell}
                  allowsSelection={true}
                  onSelectionChange={this.handleSelectionChange.bind(this)}
                  selectedIndexPaths={this.state.selectedIndexPaths}
                />
              </div>
            </>
          }
        </div>
      </>
    )
  }
}