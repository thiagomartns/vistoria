using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vistoria.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInspectionCompletedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CompletedById",
                table: "inspections",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletedByName",
                table: "inspections",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: true);

            // As concluídas de antes ganham a autoria do dono, que na V1 é o único vistoriador da conta (ADR 0003), com
            // o nome de hoje (ADR 0053). O UPDATE sobe o rowversion: o delta as reenvia e os aparelhos recebem a autoria.
            migrationBuilder.Sql(
                """
                UPDATE i
                SET i.CompletedById = u.Id, i.CompletedByName = u.Name
                FROM inspections AS i
                INNER JOIN users AS u ON u.Id = i.OwnerId
                WHERE i.Status = 'Completed' AND i.CompletedById IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompletedById",
                table: "inspections");

            migrationBuilder.DropColumn(
                name: "CompletedByName",
                table: "inspections");
        }
    }
}
