using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CareCall.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPatientDischargePlanning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BaselineSymptoms",
                table: "Patients",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "DischargeReport",
                table: "Patients",
                type: "TEXT",
                maxLength: 20000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "FollowUpQuestions",
                table: "Patients",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "QuestionPlanReady",
                table: "Patients",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BaselineSymptoms",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "DischargeReport",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "FollowUpQuestions",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "QuestionPlanReady",
                table: "Patients");
        }
    }
}
