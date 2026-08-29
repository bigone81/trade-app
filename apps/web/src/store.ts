import { create } from 'zustand';
import type { DrawingTool, RiskReward } from '@trade/shared';

const readNumber=(key:string,fallback:number)=>{const value=Number(localStorage.getItem(key));return Number.isFinite(value)?value:fallback;};
const readText=(key:string,fallback:string)=>localStorage.getItem(key)||fallback;

interface UiState{
  symbol:string;timeframe:string;tool:DrawingTool;drawerOpen:boolean;selectedRiskReward:RiskReward|null;selectedAccountId:number;
  minTurnoverMillions:number;levelTolerancePercent:number;
  setSymbol:(v:string)=>void;setTimeframe:(v:string)=>void;setTool:(v:DrawingTool)=>void;selectRiskReward:(v:RiskReward|null)=>void;setDrawerOpen:(v:boolean)=>void;setAccountId:(v:number)=>void;
  setMinTurnoverMillions:(v:number)=>void;setLevelTolerancePercent:(v:number)=>void;
}

export const useUi=create<UiState>((set)=>({
  symbol:(new URLSearchParams(location.search).get('symbol')||readText('trade.lastSymbol','BTCUSDT')).toUpperCase(),
  timeframe:readText('trade.lastTimeframe','15'),
  tool:'select',drawerOpen:false,selectedRiskReward:null,selectedAccountId:2,
  minTurnoverMillions:readNumber('trade.scanner.minTurnoverMillions',50),
  levelTolerancePercent:readNumber('trade.scanner.levelTolerancePercent',10),
  setSymbol:(symbol)=>{const value=symbol.toUpperCase();localStorage.setItem('trade.lastSymbol',value);set({symbol:value,selectedRiskReward:null});},
  setTimeframe:(timeframe)=>{localStorage.setItem('trade.lastTimeframe',timeframe);set({timeframe});},
  setTool:(tool)=>set({tool}),
  selectRiskReward:(selectedRiskReward)=>set({selectedRiskReward,drawerOpen:Boolean(selectedRiskReward)}),
  setDrawerOpen:(drawerOpen)=>set({drawerOpen}),
  setAccountId:(selectedAccountId)=>set({selectedAccountId}),
  setMinTurnoverMillions:(minTurnoverMillions)=>{localStorage.setItem('trade.scanner.minTurnoverMillions',String(minTurnoverMillions));set({minTurnoverMillions});},
  setLevelTolerancePercent:(levelTolerancePercent)=>{localStorage.setItem('trade.scanner.levelTolerancePercent',String(levelTolerancePercent));set({levelTolerancePercent});},
}));
