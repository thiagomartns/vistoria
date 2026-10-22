using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

// Chave, versão, índice de dono e soft delete vêm do AppDbContext, comuns a toda SyncEntity.
public class PropertyConfiguration : IEntityTypeConfiguration<Property>
{
    public const int StreetMaxLength = 120;
    public const int NumberMaxLength = 10;
    public const int ComplementMaxLength = 60;
    public const int DistrictMaxLength = 60;
    public const int CityMaxLength = 60;
    public const int StateLength = 2;
    public const int ZipCodeLength = 8;
    public const int TypeMaxLength = 20;
    public const int NotesMaxLength = 1000;

    public void Configure(EntityTypeBuilder<Property> builder)
    {
        builder.ToTable("properties");
        builder.Property(p => p.Street).HasMaxLength(StreetMaxLength);
        builder.Property(p => p.Number).HasMaxLength(NumberMaxLength);
        builder.Property(p => p.Complement).HasMaxLength(ComplementMaxLength);
        builder.Property(p => p.District).HasMaxLength(DistrictMaxLength);
        builder.Property(p => p.City).HasMaxLength(CityMaxLength);
        builder.Property(p => p.State).HasMaxLength(StateLength).IsFixedLength();
        builder.Property(p => p.ZipCode).HasMaxLength(ZipCodeLength).IsFixedLength();
        builder.Property(p => p.Type).HasConversion<string>().HasMaxLength(TypeMaxLength);
        builder.Property(p => p.Notes).HasMaxLength(NotesMaxLength);

        // O service já confere que o cliente existe e é do mesmo dono; o FK garante o mesmo no banco. Cliente não é
        // excluído na V1, então Restrict nunca dispara pelo app.
        builder.HasOne<Client>().WithMany().HasForeignKey(p => p.ClientId).OnDelete(DeleteBehavior.Restrict);
    }
}
