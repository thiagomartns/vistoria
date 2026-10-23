using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

// Chave, versão, índice de dono e soft delete vêm do AppDbContext, comuns a toda SyncEntity.
public class TemplateConfiguration : IEntityTypeConfiguration<Template>
{
    public const int NameMinLength = 1;
    public const int NameMaxLength = 60;
    public const int RoomsMax = 40;
    public const int ItemsMax = 60;

    // Mesmos limites de Room e Item da vistoria (vision.md, "Room e Item").
    public const int RoomNameMaxLength = 60;
    public const int ItemNameMaxLength = 60;

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
