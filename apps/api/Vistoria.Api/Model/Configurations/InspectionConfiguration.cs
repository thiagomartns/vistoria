using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

// Chave, versão, índice de dono e soft delete vêm do AppDbContext, comuns a toda SyncEntity.
public class InspectionConfiguration : IEntityTypeConfiguration<Inspection>
{
    public const int GeneralNotesMaxLength = 2000;
    public const int RoomsMax = 40;
    public const int KindMaxLength = 20;
    public const int StatusMaxLength = 20;

    public void Configure(EntityTypeBuilder<Inspection> builder)
    {
        builder.ToTable("inspections");
        builder.Property(i => i.Kind).HasConversion<string>().HasMaxLength(KindMaxLength);
        builder.Property(i => i.Status).HasConversion<string>().HasMaxLength(StatusMaxLength);
        builder.Property(i => i.GeneralNotes).HasMaxLength(GeneralNotesMaxLength);
        builder.Property(i => i.CompletedByName).HasMaxLength(UserConfiguration.NameMaxLength);

        // A cópia da conclusão, com os tamanhos do imóvel e do cliente de onde vem (ADR 0068).
        builder.ComplexProperty(i => i.CompletedSnapshot, snapshot =>
        {
            snapshot.Property(s => s.Street).HasMaxLength(PropertyConfiguration.StreetMaxLength);
            snapshot.Property(s => s.Number).HasMaxLength(PropertyConfiguration.NumberMaxLength);
            snapshot.Property(s => s.Complement).HasMaxLength(PropertyConfiguration.ComplementMaxLength);
            snapshot.Property(s => s.District).HasMaxLength(PropertyConfiguration.DistrictMaxLength);
            snapshot.Property(s => s.City).HasMaxLength(PropertyConfiguration.CityMaxLength);
            snapshot.Property(s => s.State).HasMaxLength(PropertyConfiguration.StateLength).IsFixedLength();
            snapshot.Property(s => s.ZipCode).HasMaxLength(PropertyConfiguration.ZipCodeLength).IsFixedLength();
            snapshot.Property(s => s.PropertyType).HasConversion<string>()
                .HasMaxLength(PropertyConfiguration.TypeMaxLength);
            snapshot.Property(s => s.ClientName).HasMaxLength(ClientConfiguration.NameMaxLength);
            snapshot.Property(s => s.ClientDocument).HasMaxLength(ClientConfiguration.DocumentMaxLength);
        });

        // Imóvel e vistoria de referência não são excluídos fisicamente pelo app: Restrict nunca dispara por ele.
        builder.HasOne<Property>().WithMany().HasForeignKey(i => i.PropertyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Inspection>().WithMany().HasForeignKey(i => i.ReferenceInspectionId)
            .OnDelete(DeleteBehavior.Restrict);

        // Cascade só vale numa exclusão física da raiz; a do app é soft (AppDbContext).
        builder.HasMany(i => i.Rooms).WithOne().HasForeignKey(r => r.InspectionId).OnDelete(DeleteBehavior.Cascade);
    }
}
