import QueryOperator from "../BaseDatabase/QueryOperator";
import BadDataException from "../Exception/BadDataException";
import Typeof from "../Typeof";

export type CompareType = number | Date | string;

export default class CompareBase<
  T extends CompareType,
> extends QueryOperator<T> {
  private _value!: T;
  public get value(): T {
    return this._value;
  }
  public set value(v: T) {
    this._value = v;
  }

  public constructor(value: T) {
    super();
    this.value = value;
  }

  public override toString(): string {
    return this.value.toString();
  }

  public toNumber(): number {
    if (Typeof.Number === typeof this.value) {
      return this.value as number;
    }

    throw new BadDataException("Value is not a number");
  }

  public toDate(): Date {
    if (this.value instanceof Date) {
      return this.value as Date;
    }

    throw new BadDataException("Value is not a date object");
  }
}
