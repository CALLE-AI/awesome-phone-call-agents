export class OrganizationId {
  public readonly value: string;

  private constructor(value: string) {
    this.value = value;
    Object.freeze(this);
  }

  public static create(value: string): OrganizationId {
    if (value.length === 0 || value.trim() !== value) {
      throw new Error("OrganizationId must be a non-empty, trimmed value");
    }

    return new OrganizationId(value);
  }

  public equals(other: OrganizationId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }
}
