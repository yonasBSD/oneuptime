import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1772110755000 implements MigrationInterface {
  public name = "MigrationName1772110755000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "release" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "environment" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "environment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "release"`,
    );
  }
}
