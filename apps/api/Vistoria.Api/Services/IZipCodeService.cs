using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

public interface IZipCodeService
{
    /// <summary>
    /// O endereço de <paramref name="zipCode"/>, normalizado no formato do <c>Property</c>, pelo cache ou pelos
    /// provedores (#185). Fora de <c>^[0-9]{8}$</c> → <c>ValidationException</c> em <c>zipCode</c>; nenhum provedor
    /// conhece → <c>NotFoundException</c>; os dois fora → <c>UpstreamUnavailableException</c>.
    /// </summary>
    Task<ZipCodeAddressDto> FindAsync(string zipCode, CancellationToken cancellationToken);
}
