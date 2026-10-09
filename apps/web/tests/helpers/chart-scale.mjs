import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the installed chart library's real pixel/index conversion methods.
// A linear mock accepting fractional indices hid the original RR regression.
const source = ts.createSourceFile('lightweight-charts.mjs', readFileSync(
  new URL('./lightweight-charts.development.mjs', import.meta.resolve('lightweight-charts')), 'utf8',
), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function methods(className, names) {
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  const code = names.map(name => declaration.members.find(member => member.name?.getText(source) === name).getText(source));
  return vm.runInNewContext(`({ ${code.join(',\n')} })`, { isInteger: Number.isInteger });
}

export function chartScaleCoordinates(state) {
  const internal = {
    ...methods('TimeScale', ['_internal_indexToCoordinate', '_internal_coordinateToIndex',
      '_private__coordinateToFloatIndex', '_private__rightOffsetForCoordinate']),
    _internal_isEmpty: () => !state.count,
    _internal_baseIndex: () => state.count - 1,
    get _private__width() { return state.offset + (state.count - 0.5) * state.spacing + 1; },
    get _private__barSpacing() { return state.spacing; },
    _private__rightOffset: 0,
  };
  return {
    ...methods('TimeScaleApi', ['logicalToCoordinate', 'coordinateToLogical']),
    _private__model: { _internal_timeScale: () => internal },
    _private__timeScale: internal,
  };
}
