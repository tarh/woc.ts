import { AppBkb } from "./AppBkb"
import { OrderCallback, OrderName } from "./exported-definitions"
import { arr } from "./utils"

interface Cb {
  cb: OrderCallback
  thisArg: any
}

export class DescendingOrderManager {
  private map = new Map<string, Cb[]>()

  constructor(private app: AppBkb, private componentId: number) {
  }

  invokeOrder(orderName: OrderName, orderData: any) {
    for (let name of arr(orderName))
      this.exec(name, orderData)
    let children = this.app.getChildrenOf(this.componentId)
    for (let child of children)
      child.getDOrders().invokeOrder(orderName, orderData)
  }

  listenToDescendingOrder(orderName: OrderName, listener: OrderCallback, thisArg: any = null) {
    for (let name of arr(orderName)) {
      let list = this.map.get(name)
      if (!list)
        this.map.set(name, list = [])
      list.push({
        cb: listener,
        thisArg
      })
    }
  }

  stopListeningDescendingOrder(orderName: OrderName, listener: OrderCallback, thisArg: any = null) {
    for (let name of arr(orderName)) {
      let list = this.map.get(name)
      if (list)
        this.map.set(name, list.filter(cb => cb.cb !== listener || cb.thisArg !== thisArg))
    }
  }

  private exec(name: string, orderData: any) {
    let list = this.map.get(name)
    if (list)
      list.forEach(cb => call(cb, orderData))
  }
}

function call(cb: Cb, orderData: any) {
  if (cb.thisArg)
    cb.cb.call(cb.thisArg, orderData)
  else
    cb.cb(orderData)
}
