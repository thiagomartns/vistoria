using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vistoria.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInspectionCompletedSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_City",
                table: "inspections",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_ClientDocument",
                table: "inspections",
                type: "nvarchar(14)",
                maxLength: 14,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_ClientName",
                table: "inspections",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_Complement",
                table: "inspections",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_District",
                table: "inspections",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_Number",
                table: "inspections",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_PropertyType",
                table: "inspections",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_State",
                table: "inspections",
                type: "nchar(2)",
                fixedLength: true,
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_Street",
                table: "inspections",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedSnapshot_ZipCode",
                table: "inspections",
                type: "nchar(8)",
                fixedLength: true,
                maxLength: 8,
                nullable: true);

            // As concluídas de antes ganham a cópia com o imóvel e o cliente de hoje: o laudo delas já os mostrava, e
            // daqui em diante não mudam mais (ADR 0068). O UPDATE sobe o rowversion: o delta as reenvia, como na
            // AddInspectionCompletedBy (ADR 0053). Inclui as excluídas, para a cópia não depender de quando saíram.
            migrationBuilder.Sql(
                """
                UPDATE i
                SET i.CompletedSnapshot_Street = p.Street,
                    i.CompletedSnapshot_Number = p.Number,
                    i.CompletedSnapshot_Complement = p.Complement,
                    i.CompletedSnapshot_District = p.District,
                    i.CompletedSnapshot_City = p.City,
                    i.CompletedSnapshot_State = p.State,
                    i.CompletedSnapshot_ZipCode = p.ZipCode,
                    i.CompletedSnapshot_PropertyType = p.Type,
                    i.CompletedSnapshot_ClientName = c.Name,
                    i.CompletedSnapshot_ClientDocument = c.Document
                FROM inspections AS i
                INNER JOIN properties AS p ON p.Id = i.PropertyId
                INNER JOIN clients AS c ON c.Id = p.ClientId
                WHERE i.Status = 'Completed' AND i.CompletedSnapshot_Street IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_City",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_ClientDocument",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_ClientName",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_Complement",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_District",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_Number",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_PropertyType",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_State",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_Street",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedSnapshot_ZipCode",
                table: "inspections");
        }
    }
}
