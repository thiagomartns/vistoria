using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

// Chave, versão, índice de dono e soft delete vêm do AppDbContext, comuns a toda SyncEntity.
public class TemplateConfiguration : IEntityTypeConfiguration<Template>
{
    public const int NameMinLength = 1;
    public const int NameMaxLength = 60;

    // Mesmos limites de Room e Item da vistoria (vision.md, "Client, Property e Template").
    public const int RoomsMax = InspectionConfiguration.RoomsMax;
    public const int ItemsMax = RoomConfiguration.ItemsMax;
    public const int RoomNameMaxLength = RoomConfiguration.NameMaxLength;
    public const int ItemNameMaxLength = InspectionItemConfiguration.NameMaxLength;

    public void Configure(EntityTypeBuilder<Template> builder)
    {
        builder.ToTable("templates");
        builder.Property(t => t.Name).HasMaxLength(NameMaxLength);

        // Uma coluna JSON com os ambientes e, dentro de cada um, os itens. Os limites de tamanho valem no DTO: a
        // coluna é nvarchar(max) no SQL Server 2022.
        builder.ComplexCollection(t => t.Rooms, rooms =>
        {
            rooms.ToJson();
            rooms.ComplexCollection(r => r.Items);
        });
    }
}
