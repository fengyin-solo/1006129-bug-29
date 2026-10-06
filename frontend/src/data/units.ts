// 监测单位清单：测点归属、阈值权限都按这套单位判定。
export const MONITORING_UNITS: string[] = ['监测一单位', '监测二单位', '监测三单位']

// 老数据没有归属单位时，统一补挂到默认单位名下。
export const DEFAULT_UNIT: string = MONITORING_UNITS[0]
